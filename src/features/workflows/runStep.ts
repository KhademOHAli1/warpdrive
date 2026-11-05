import { eq } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { workflowRuns } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { validateNodeConfiguration } from "./configurationValidation";
import { delayScheduleAt } from "./delay";
import { executableNode } from "./readiness";
import { executeRunNode } from "./runActions";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import { advanceWorkflowHumanForm } from "./workflowHumanFormWait";
import { readWorkflowRunLaunch } from "./workflowRunLaunchContract";

type StepProgress =
  | { status: "waiting"; armedDeadline?: Date }
  | { status: "completed"; output: StepOutput };

async function advanceDelay(
  db: Db,
  node: WorkflowNode,
  run: typeof workflowRuns.$inferSelect,
  now: Date,
  definition: WorkflowDefinition,
  outputs: RunOutputs,
  signal: AbortSignal,
): Promise<Result<StepProgress, string>> {
  if (run.status === "waiting") {
    const deadline = run.resumeAt;
    if (deadline === null || !Number.isFinite(deadline.getTime()))
      return err(ERROR_IDS.WORKFLOW_INVALID);
    return deadline.getTime() > now.getTime()
      ? ok({ status: "waiting" })
      : ok({ status: "completed", output: { resumeAt: deadline.toISOString() } });
  }
  const deadline = delayScheduleAt(node.config, now, { definition, nodeId: node.id, outputs });
  if (!deadline.ok) return deadline;
  if (run.mode === "simulation" || deadline.value.getTime() <= now.getTime())
    return ok({ status: "completed", output: { resumeAt: deadline.value.toISOString() } });
  await db
    .update(workflowRuns)
    .set({ status: "waiting", resumeAt: deadline.value, updatedAt: now })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok({ status: "waiting", armedDeadline: deadline.value });
}

// The caller holds this run's row lock and has rehydrated its current authority.
export async function advanceRunStep(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  run: typeof workflowRuns.$inferSelect,
  now: Date,
  definition: WorkflowDefinition,
  signal: AbortSignal,
  outputs: RunOutputs = run.outputs,
): Promise<Result<StepProgress, string>> {
  if (!executableNode(node)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  const launch = readWorkflowRunLaunch(definition, run.trigger);
  if (launch === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  if (
    node.type !== "activity.create" &&
    validateNodeConfiguration(node, { definition }).status !== "valid"
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (node.type === "human.form") return advanceWorkflowHumanForm(db, run, now, signal);
  if (node.type === "delay") return advanceDelay(db, node, run, now, definition, outputs, signal);
  if (run.status === "waiting") return err(ERROR_IDS.WORKFLOW_INVALID);
  const result = await executeRunNode(
    db,
    actor,
    node,
    outputs,
    launch,
    run.mode === "simulation",
    definition,
    signal,
    { runId: run.id, workflowId: run.workflowId },
  );
  return result.ok ? ok({ status: "completed", output: result.value }) : result;
}
