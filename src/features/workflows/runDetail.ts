import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns, workflowSteps, workflowVersions } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok } from "@/types/result";
import { getWorkflow } from "./queries";
import { describeRunRecovery, readFailureHistories } from "./runRecovery";
import { definitionSchema } from "./schemas";

// Return the historical configuration and execution metadata, never stored CRM outputs.
export async function readRunDetail(
  db: Db,
  actor: PermSetUser,
  workflowId: string,
  runId: string,
  signal: AbortSignal,
) {
  if (!z.string().uuid().safeParse(runId).success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const workflow = await getWorkflow(db, actor, workflowId, signal);
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
      ...(deadline?.success === true ? { waitResumeAt: new Date(deadline.data) } : {}),
    };
  });
  const failures = await readFailureHistories(db, [runId], signal);
  const { stored, ...safeRun } = run;
  const recovery = await describeRunRecovery(
    db,
    actor,
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
    ...(recovery === null ? {} : { recovery }),
  });
}
