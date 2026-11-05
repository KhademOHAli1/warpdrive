import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { selectRunBranch } from "./runBranchSelection";
import { advanceRunStep } from "./runStep";
import type { StepOutput } from "./runTypes";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";
import type {
  WorkflowExternalEffectClaim,
  WorkflowExternalEffectTx,
} from "./workflowExternalEffect";
import { projectWorkflowHttpStep } from "./workflowHttpExecution";
import { workflowHttpOperatorServices } from "./workflowHttpOperatorPolicy";
import { dispatchClaimedWorkflowHttpRequest } from "./workflowHttpRequestWorker";
import { workflowIteratorAllowsUnframedNode } from "./workflowIteratorGraph";
import { advanceWorkflowIteratorRun } from "./workflowIteratorRun";
import { verifyWorkflowRunLaunch } from "./workflowRunLaunch";

export { admitManualRun } from "./runAdmission";

interface LockedWorkflowStep {
  db: WorkflowExternalEffectTx;
  actor: PermSetUser;
  workflowOwnerId: string;
  run: typeof workflowRuns.$inferSelect;
  node: WorkflowNode;
  definition: WorkflowDefinition;
  now: Date;
  signal: AbortSignal;
}

async function advanceLockedStep(context: LockedWorkflowStep) {
  const { db, actor, workflowOwnerId, run, node, definition, now, signal } = context;
  if (run.iteratorFrame !== null || node.type === "iterator")
    return advanceWorkflowIteratorRun({ db, actor, node, run, now, definition, signal });
  if (!workflowIteratorAllowsUnframedNode(definition, node.id))
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const result =
    node.type === "http.request"
      ? await projectWorkflowHttpStep(
          { tx: db, actor, workflowOwnerId, run, node, definition },
          signal,
        )
      : await advanceRunStep(db, actor, node, run, now, definition, signal);
  if (!result.ok) return result;
  if (result.value.status !== "completed") return ok(result.value);
  return writeStepReceipt(context, result.value.output);
}

async function writeStepReceipt(
  { db, run, node, definition, now, signal }: LockedWorkflowStep,
  output: StepOutput,
) {
  const selected = selectRunBranch(definition, node, output);
  if (!selected.ok) return selected;
  const next = selected.value;
  await db.insert(workflowSteps).values({
    runId: run.id,
    nodeId: node.id,
    simulated: run.mode === "simulation",
    output,
    completedAt: now,
  });
  const status = next === undefined ? ("succeeded" as const) : ("running" as const);
  await db
    .update(workflowRuns)
    .set({
      status,
      resumeAt: null,
      nextNodeId: next?.to ?? null,
      outputs: { ...run.outputs, [node.id]: output },
      updatedAt: now,
    })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok({ status });
}

// Database-only effects and progress share this transaction. A crash rolls both back;
// competing workers serialize on the run row and re-read the persisted cursor.
export async function advanceWorkflowRun(
  db: Db,
  runId: string,
  signal: AbortSignal,
  onWaitArmed?: (deadline: Date, databaseNow: Date) => Promise<void>,
) {
  if (!z.string().uuid().safeParse(runId).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  let wait: { deadline: Date | undefined; databaseNow: Date } | undefined;
  let dispatch: WorkflowExternalEffectClaim | undefined;
  const progress = await db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId))
      .for("update");
    signal.throwIfAborted();
    if (run === undefined) return err(ERROR_IDS.WORKFLOW_DENIED);
    if (run.status !== "queued" && run.status !== "running" && run.status !== "waiting")
      return ok(run.status);
    // Read the clock after acquiring the row lock, including time spent waiting for it.
    const clock = await tx.execute<{ milliseconds: number }>(
      sql`SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds`,
    );
    const now = new Date(clock.rows[0]?.milliseconds ?? Number.NaN);
    if (!Number.isFinite(now.getTime())) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
    signal.throwIfAborted();
    const actor = await hydrateActor(tx, run.actorId, signal);
    const [workflow] = await tx.select().from(workflows).where(eq(workflows.id, run.workflowId));
    const [version] = await tx
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.id, run.versionId));
    if (
      actor === null ||
      workflow === undefined ||
      !canWorkflow(actor, "run", workflow.ownerId) ||
      workflow.archivedAt !== null ||
      version === undefined
    )
      return failRun(tx, run, ERROR_IDS.WORKFLOW_DENIED, now, signal);
    const parsed = definitionSchema.safeParse(version.definition);
    if (!parsed.success) return failRun(tx, run, ERROR_IDS.WORKFLOW_INVALID, now, signal);
    const definition = parsed.data;
    const launch = verifyWorkflowRunLaunch(definition, run, workflow.ownerId, version.createdAt);
    if (!launch.ok) return failRun(tx, run, launch.error, now, signal);
    const node = definition.nodes.find((item) => item.id === run.nextNodeId);
    if (node === undefined) return failRun(tx, run, ERROR_IDS.WORKFLOW_DENIED, now, signal);
    const result = await advanceLockedStep({
      db: tx,
      actor,
      workflowOwnerId: workflow.ownerId,
      run,
      node,
      definition,
      now,
      signal,
    });
    if (!result.ok) return failRun(tx, run, result.error, now, signal);
    if (result.value.status === "waiting")
      wait = { deadline: result.value.armedDeadline, databaseNow: now };
    if (result.value.status === "external-pending") {
      dispatch = result.value.claim;
      return ok("waiting" as const);
    }
    return ok(result.value.status);
  });
  if (dispatch !== undefined) {
    const outcome = await dispatchClaimedWorkflowHttpRequest(
      db,
      dispatch,
      workflowHttpOperatorServices,
      signal,
    );
    return ok(
      outcome.ok && outcome.value.state !== "started" ? ("running" as const) : ("waiting" as const),
    );
  }
  if (wait?.deadline !== undefined) await onWaitArmed?.(wait.deadline, wait.databaseNow);
  return progress;
}

async function failRun(
  db: Db,
  run: typeof workflowRuns.$inferSelect,
  errorId: string,
  now: Date,
  signal: AbortSignal,
) {
  await db.insert(workflowRunFailures).values({
    runId: run.id,
    nodeId: run.nextNodeId,
    errorId,
    failedAt: now,
    originalResumeAt: run.resumeAt,
  });
  await db
    .update(workflowRuns)
    .set({ status: "failed", resumeAt: null, iteratorFrame: null, errorId, updatedAt: now })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok("failed" as const);
}
