import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { getWorkflow } from "./queries";
import { describeRunRecovery, readFailureHistories } from "./runRecovery";
import { definitionSchema } from "./schemas";
import { pendingWorkflowHumanForm } from "./workflowHumanFormPending";
import { workflowIteratorSummary } from "./workflowIteratorRuntimeContract";
import {
  readWorkflowManualLaunch,
  type WorkflowManualLaunchPayload,
} from "./workflowManualLaunchContract";

async function formLaunchVisible(
  db: Db,
  actor: PermSetUser,
  launch: WorkflowManualLaunchPayload,
  signal: AbortSignal,
) {
  if (!("recordId" in launch)) return true;
  const visible = await assertReferenceVisible(
    db,
    {
      userId: actor.id,
      isActive: actor.isActive,
      isAdmin: actor.type === "admin",
      sessionLive: true,
      visibilityGroupIds: [...actor.groupIds],
      managedUserIds: [...(actor.managedUserIds ?? [])],
    },
    { kind: "deal", id: launch.recordId },
    signal,
  );
  return visible.ok;
}

function publicStep(
  step: typeof workflowSteps.$inferSelect,
  node: z.infer<typeof definitionSchema>["nodes"][number] | undefined,
) {
  const { nodeId, simulated, completedAt, output, iterationIndex } = step;
  const deadline = node?.type === "delay" ? z.iso.datetime().safeParse(output.resumeAt) : null;
  const summary = node?.type === "iterator" ? workflowIteratorSummary.safeParse(output) : null;
  const failure = Object.values(ERROR_IDS).find((id) => id === step.errorId);
  return {
    nodeId,
    simulated,
    completedAt,
    ...(node?.type === "record.delete" && output.deleted === true
      ? { recordDeleted: true as const }
      : {}),
    ...(deadline?.success === true ? { waitResumeAt: new Date(deadline.data) } : {}),
    ...(iterationIndex >= 0 ? { iterationIndex } : {}),
    ...(step.outcome === "failed"
      ? { outcome: "failed" as const, errorId: failure ?? ERROR_IDS.WORKFLOW_WRITE_FAILED }
      : {}),
    ...(summary?.success === true
      ? {
          iteratorSummary: {
            processedCount: summary.data.processedCount,
            failedCount: summary.data.failedCount,
          },
        }
      : {}),
  };
}

// Return the historical configuration and execution metadata, never stored CRM outputs.
export async function readRunDetail(
  db: Db,
  actor: PermSetUser,
  workflowId: string,
  runId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (!z.string().uuid().safeParse(runId).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const currentActor = await hydrateActor(db, actor.id, signal);
  if (currentActor === null) return err(ERROR_IDS.WORKFLOW_DENIED);
  const workflow = await getWorkflow(db, currentActor, workflowId, signal);
  if (!workflow.ok) return workflow;
  const [run] = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      mode: workflowRuns.mode,
      resumeAt: workflowRuns.resumeAt,
      responseWindowOpen: sql<boolean>`COALESCE(${workflowRuns.resumeAt} > clock_timestamp(), false)`,
      nextNodeId: workflowRuns.nextNodeId,
      errorId: workflowRuns.errorId,
      createdAt: workflowRuns.createdAt,
      updatedAt: workflowRuns.updatedAt,
      number: workflowVersions.number,
      definition: workflowVersions.definition,
      stored: workflowRuns,
    })
    .from(workflowRuns)
    .innerJoin(
      workflowVersions,
      and(
        eq(workflowVersions.id, workflowRuns.versionId),
        eq(workflowVersions.workflowId, workflowRuns.workflowId),
      ),
    )
    .where(and(eq(workflowRuns.id, runId), eq(workflowRuns.workflowId, workflowId)));
  signal.throwIfAborted();
  if (run === undefined) return err(ERROR_IDS.WORKFLOW_DENIED);
  const definition = definitionSchema.safeParse(run.definition);
  if (!definition.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.runId, runId))
    .orderBy(workflowSteps.completedAt);
  signal.throwIfAborted();
  const safeSteps = steps.map((step) =>
    publicStep(
      step,
      definition.data.nodes.find((item) => item.id === step.nodeId),
    ),
  );
  const failures = await readFailureHistories(db, [runId], signal);
  const { stored, responseWindowOpen, ...safeRun } = run;
  const waitingForForm =
    run.status === "waiting" &&
    definition.data.nodes.some((node) => node.id === run.nextNodeId && node.type === "human.form");
  const responseRecorded = safeSteps.some((step) => step.nodeId === run.nextNodeId);
  const form = pendingWorkflowHumanForm(
    stored,
    definition.data,
    currentActor.id,
    responseWindowOpen &&
      !responseRecorded &&
      workflow.value.archivedAt === null &&
      canWorkflow(currentActor, "run", workflow.value.ownerId),
  );
  const launch =
    form === undefined ? null : readWorkflowManualLaunch(definition.data, stored.trigger);
  const pendingForm =
    launch !== null && (await formLaunchVisible(db, currentActor, launch, signal))
      ? form
      : undefined;
  const recovery = await describeRunRecovery(
    db,
    currentActor,
    workflow.value,
    stored,
    run.definition,
    steps,
    failures.get(runId) ?? [],
    signal,
  );
  return ok({
    ...safeRun,
    definition: definition.data,
    steps: safeSteps,
    ...(pendingForm === undefined ? {} : { pendingForm }),
    ...(waitingForForm && !responseWindowOpen && !responseRecorded
      ? { formExpired: true as const }
      : {}),
    ...(recovery === null ? {} : { recovery }),
  });
}
