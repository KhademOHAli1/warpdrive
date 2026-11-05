import { and, eq, gt, sql, TransactionRollbackError } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflows, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import { inspectGraph } from "./graph";
import { selectRunBranch } from "./runBranchSelection";
import { currentRetryActor } from "./runRetrySession";
import type { RetrySessionRef } from "./runRetryTypes";
import type { StepOutput } from "./runTypes";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import {
  parseWorkflowHumanFormAnswers,
  type WorkflowHumanFormConfig,
  workflowHumanFormConfig,
} from "./workflowHumanFormContract";
import { verifyWorkflowRunLaunch } from "./workflowRunLaunch";
import type { WorkflowRunLaunchPayload } from "./workflowRunLaunchContract";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const submissionSchema = z.strictObject({
  workflowId: uuid,
  runId: uuid,
  nodeId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  requestKey: uuid,
  answers: z.unknown(),
});
const receiptSchema = z.strictObject({ requestKey: uuid });
type Submission = z.infer<typeof submissionSchema>;
type Run = typeof workflowRuns.$inferSelect;
type FormResult = Result<{ id: string; replayed: boolean }, string>;
interface FormContext {
  run: Run;
  ownerId: string;
  definition: WorkflowDefinition;
  node: WorkflowNode;
  config: WorkflowHumanFormConfig;
  launch: WorkflowRunLaunchPayload;
}

async function currentFormActor(
  db: Db,
  who: RetrySessionRef,
  ownerId: string,
  signal: AbortSignal,
) {
  const actor = await currentRetryActor(db, who, signal);
  return actor !== null && canWorkflow(actor, "view", ownerId) && canWorkflow(actor, "run", ownerId)
    ? actor
    : null;
}

async function formLaunchVisible(
  db: Db,
  actor: PermSetUser,
  launch: WorkflowRunLaunchPayload,
  signal: AbortSignal,
) {
  if (!("recordId" in launch)) return true;
  const visible = await assertReferenceVisible(
    db,
    {
      userId: actor.id,
      isActive: actor.isActive,
      sessionLive: true,
      isAdmin: actor.type === "admin",
      visibilityGroupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    { kind: "deal", id: launch.recordId },
    signal,
  );
  return visible.ok;
}

async function lockedForm(
  db: Db,
  who: RetrySessionRef,
  input: Submission,
  signal: AbortSignal,
): Promise<Result<FormContext, string>> {
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.id, input.runId),
        eq(workflowRuns.workflowId, input.workflowId),
        eq(workflowRuns.actorId, who.userId),
      ),
    )
    .for("update");
  signal.throwIfAborted();
  if (run?.mode !== "live") return err(ERROR_IDS.WORKFLOW_DENIED);
  // Archive takes an exclusive workflow lock. A pause only blocks new admission.
  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, run.workflowId))
    .for("share");
  if (workflow === undefined || workflow.archivedAt !== null) return err(ERROR_IDS.WORKFLOW_DENIED);
  const actor = await currentFormActor(db, who, workflow.ownerId, signal);
  if (actor === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  const [version] = await db
    .select({ definition: workflowVersions.definition, publishedAt: workflowVersions.createdAt })
    .from(workflowVersions)
    .where(
      and(eq(workflowVersions.id, run.versionId), eq(workflowVersions.workflowId, run.workflowId)),
    );
  const parsed = definitionSchema.safeParse(version?.definition);
  if (version === undefined || !parsed.success || inspectGraph(parsed.data).length > 0)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const launch = verifyWorkflowRunLaunch(parsed.data, run, workflow.ownerId, version.publishedAt);
  if (!launch.ok) return launch;
  if (!(await formLaunchVisible(db, actor, launch.value, signal)))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const node = parsed.data.nodes.find((candidate) => candidate.id === input.nodeId);
  if (node?.type !== "human.form") return err(ERROR_IDS.WORKFLOW_CONFLICT);
  const config = workflowHumanFormConfig.safeParse(node.config);
  return config.success
    ? ok({
        run,
        ownerId: workflow.ownerId,
        definition: parsed.data,
        node,
        config: config.data,
        launch: launch.value,
      })
    : err(ERROR_IDS.WORKFLOW_INVALID);
}

function matchesReceipt(
  step: Pick<typeof workflowSteps.$inferSelect, "simulated" | "output">,
  requestKey: string,
  answers: StepOutput,
) {
  const { _formSubmission, ...storedAnswers } = step.output;
  const receipt = receiptSchema.safeParse(_formSubmission);
  const fields = Object.entries(answers);
  return (
    !step.simulated &&
    receipt.success &&
    receipt.data.requestKey === requestKey &&
    Object.keys(storedAnswers).length === fields.length &&
    fields.every(
      ([key, value]) => Object.hasOwn(storedAnswers, key) && storedAnswers[key] === value,
    )
  );
}

async function completeForm(
  db: Db,
  { run, definition, node }: FormContext,
  requestKey: string,
  answers: StepOutput,
  signal: AbortSignal,
): Promise<FormResult> {
  if (run.status !== "waiting" || run.nextNodeId !== node.id || Object.hasOwn(run.outputs, node.id))
    return err(ERROR_IDS.WORKFLOW_CONFLICT);
  const next = selectRunBranch(definition, node, answers);
  if (!next.ok) return next;
  signal.throwIfAborted();
  // Compare against the database clock at the update, after the lock and validation.
  const [updated] = await db
    .update(workflowRuns)
    .set({
      status: next.value === undefined ? "succeeded" : "running",
      nextNodeId: next.value?.to ?? null,
      resumeAt: null,
      outputs: { ...run.outputs, [node.id]: answers },
      updatedAt: sql`clock_timestamp()`,
    })
    .where(and(eq(workflowRuns.id, run.id), gt(workflowRuns.resumeAt, sql`clock_timestamp()`)))
    .returning({ updatedAt: workflowRuns.updatedAt });
  if (updated === undefined) return err(ERROR_IDS.WORKFLOW_CONFLICT);
  await db.insert(workflowSteps).values({
    runId: run.id,
    nodeId: node.id,
    simulated: false,
    output: { ...answers, _formSubmission: { requestKey } },
    completedAt: updated.updatedAt,
  });
  return ok({ id: run.id, replayed: false });
}

async function submitLockedForm(
  db: Db,
  context: FormContext,
  input: Submission,
  signal: AbortSignal,
): Promise<FormResult> {
  const answers = parseWorkflowHumanFormAnswers(context.config, input.answers);
  if (!answers.ok) return err(ERROR_IDS.WORKFLOW_INVALID);
  const [step] = await db
    .select({ output: workflowSteps.output, simulated: workflowSteps.simulated })
    .from(workflowSteps)
    .where(and(eq(workflowSteps.runId, context.run.id), eq(workflowSteps.nodeId, context.node.id)));
  signal.throwIfAborted();
  if (step === undefined) return completeForm(db, context, input.requestKey, answers.value, signal);
  return matchesReceipt(step, input.requestKey, answers.value)
    ? ok({ id: context.run.id, replayed: true })
    : err(ERROR_IDS.WORKFLOW_CONFLICT);
}

// Only the authenticated server context supplies the internal session reference.
// The caller may wake the worker after this transaction commits.
export async function submitWorkflowHumanForm(
  db: Db,
  who: RetrySessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<FormResult> {
  signal.throwIfAborted();
  const input = submissionSchema.safeParse(raw);
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  if ("rollback" in db) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  const state = { authorityLost: false };
  try {
    return await db.transaction(
      async (tx) => {
        const context = await lockedForm(tx, who, input.data, signal);
        if (!context.ok) return context;
        const result = await submitLockedForm(tx, context.value, input.data, signal);
        if (!result.ok) return result;
        const { ownerId, launch } = context.value;
        const actor = await currentFormActor(tx, who, ownerId, signal);
        if (actor === null || !(await formLaunchVisible(tx, actor, launch, signal))) {
          state.authorityLost = true;
          tx.rollback();
        }
        signal.throwIfAborted();
        return result;
      },
      { isolationLevel: "read committed" },
    );
  } catch (error) {
    signal.throwIfAborted();
    if (state.authorityLost && error instanceof TransactionRollbackError)
      return err(ERROR_IDS.WORKFLOW_DENIED);
    // Driver errors can carry SQL parameters, including answers. Return only a fixed error ID.
    return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  }
}
