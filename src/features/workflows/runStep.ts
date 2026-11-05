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
import type { StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

type StepProgress = { status: "waiting" } | { status: "completed"; output: StepOutput };

// The caller holds this run's row lock and has rehydrated its current authority.
export async function advanceRunStep(
  db: Db,
  actor: PermSetUser,
  node: WorkflowNode,
  run: typeof workflowRuns.$inferSelect,
  now: Date,
  definition: WorkflowDefinition,
  signal: AbortSignal,
): Promise<Result<StepProgress, string>> {
  if (!executableNode(node)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (
    node.type !== "activity.create" &&
    validateNodeConfiguration(node, { definition }).status !== "valid"
  )
    return err(ERROR_IDS.WORKFLOW_INVALID);
  if (run.status === "waiting") {
    const deadline = run.resumeAt;
    if (node.type !== "delay" || deadline === null || !Number.isFinite(deadline.getTime()))
      return err(ERROR_IDS.WORKFLOW_INVALID);
    return deadline.getTime() > now.getTime()
      ? ok({ status: "waiting" })
      : ok({ status: "completed", output: { resumeAt: deadline.toISOString() } });
  }
  if (node.type === "delay") {
    const deadline = delayScheduleAt(node.config, now);
    if (!deadline.ok) return deadline;
    if (run.mode === "simulation" || deadline.value.getTime() <= now.getTime())
      return ok({ status: "completed", output: { resumeAt: deadline.value.toISOString() } });
    await db
      .update(workflowRuns)
      .set({ status: "waiting", resumeAt: deadline.value, updatedAt: now })
      .where(eq(workflowRuns.id, run.id));
    signal.throwIfAborted();
    return ok({ status: "waiting" });
  }
  const result = await executeRunNode(
    db,
    actor,
    node,
    run.outputs,
    run.trigger,
    run.mode === "simulation",
    definition,
    signal,
  );
  return result.ok ? ok({ status: "completed", output: result.value }) : result;
}
