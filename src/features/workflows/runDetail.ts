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
  const safeSteps = steps.map(({ nodeId, simulated, completedAt, output }) => {
    const node = definition.data.nodes.find((item) => item.id === nodeId);
    const deadline = node?.type === "delay" ? z.iso.datetime().safeParse(output.resumeAt) : null;
    return {
      nodeId,
      simulated,
      completedAt,
      ...(node?.type === "record.delete" && output.deleted === true
        ? { recordDeleted: true as const }
        : {}),
      ...(deadline?.success === true ? { waitResumeAt: new Date(deadline.data) } : {}),
    };
  });
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
