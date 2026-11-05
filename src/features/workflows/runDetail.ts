import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { hydrateActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { canWorkflow } from "./access";
import { getWorkflow } from "./queries";
import { describeRunRecovery, readFailureHistories } from "./runRecovery";
import { definitionSchema } from "./schemas";
import { pendingWorkflowHumanForm } from "./workflowHumanFormPending";

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
  const { stored, ...safeRun } = run;
  const pendingForm = pendingWorkflowHumanForm(
    stored,
    definition.data,
    currentActor.id,
    workflow.value.archivedAt === null && canWorkflow(currentActor, "run", workflow.value.ownerId),
  );
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
    ...(recovery === null ? {} : { recovery }),
  });
}
