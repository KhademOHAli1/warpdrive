import { and, desc, eq, getTableColumns, inArray, isNull, lte, sql } from "drizzle-orm";
import { ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  activityTypes,
  deals,
  workflowRunFailures,
  type workflowRuns,
  type workflowSteps,
  type workflows,
} from "@/db/schema";
import { can } from "@/features/permissions/can";
import type { PermSetUser } from "@/features/permissions/effective";
import { assertReferenceVisible } from "@/features/permissions/referenceCheck";
import { canWorkflow } from "./access";
import { coherentFailedTask, retryableTaskDefinition } from "./runRetryProfile";
import type { RunRecovery, RunRetryReason } from "./runRetryTypes";

export type RunFailure = typeof workflowRunFailures.$inferSelect;
export type RetryRun = typeof workflowRuns.$inferSelect;
export type RetryStep = typeof workflowSteps.$inferSelect;
type Workflow = typeof workflows.$inferSelect;

const repairableErrors = new Set<string>([
  ERROR_IDS.WORKFLOW_DENIED,
  ERROR_IDS.WORKFLOW_NOT_READY,
  ERROR_IDS.PERM_DENIED,
  ERROR_IDS.DEAL_NOT_FOUND,
  ERROR_IDS.DEAL_ARCHIVED_NO_ACTIVITY,
]);

export async function readFailureHistories(db: Db, runIds: string[], signal: AbortSignal) {
  if (runIds.length === 0) return new Map<string, RunFailure[]>();
  const recent = db
    .select({
      ...getTableColumns(workflowRunFailures),
      position:
        sql<number>`row_number() over (partition by ${workflowRunFailures.runId} order by ${workflowRunFailures.failedAt} desc, ${workflowRunFailures.id} desc)`.as(
          "position",
        ),
    })
    .from(workflowRunFailures)
    .where(inArray(workflowRunFailures.runId, runIds))
    .as("recent_failures");
  const rows = await db
    .select({
      id: recent.id,
      runId: recent.runId,
      nodeId: recent.nodeId,
      errorId: recent.errorId,
      failedAt: recent.failedAt,
      origin: recent.origin,
      originalResumeAt: recent.originalResumeAt,
      retryRequestKey: recent.retryRequestKey,
      retriedBy: recent.retriedBy,
      retriedAt: recent.retriedAt,
    })
    .from(recent)
    .where(lte(recent.position, 20))
    .orderBy(desc(recent.failedAt), desc(recent.id));
  signal.throwIfAborted();
  const histories = new Map<string, RunFailure[]>();
  for (const failure of rows) {
    const current = histories.get(failure.runId) ?? [];
    current.push(failure);
    histories.set(failure.runId, current);
  }
  return histories;
}

export async function retryTaskReady(
  db: Db,
  actor: PermSetUser,
  recordId: string,
  signal: AbortSignal,
) {
  if (!can(actor, "activity.create")) return false;
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
    { kind: "deal", id: recordId },
    signal,
  );
  if (!visible.ok) return false;
  const [deal] = await db
    .select({ archivedAt: deals.archivedAt })
    .from(deals)
    .where(eq(deals.id, recordId));
  const [taskType] = await db
    .select({ id: activityTypes.id })
    .from(activityTypes)
    .where(and(eq(activityTypes.key, "task"), isNull(activityTypes.archivedAt)))
    .limit(1);
  signal.throwIfAborted();
  return deal !== undefined && deal.archivedAt === null && taskType !== undefined;
}

function fixedRetryReason(
  actor: PermSetUser,
  workflow: Workflow,
  run: RetryRun,
  failure: RunFailure | undefined,
): RunRetryReason | null {
  if (run.status !== "failed") return "notFailed";
  if (failure === undefined) return "legacy";
  if (run.actorId !== actor.id) return "actor";
  if (!canWorkflow(actor, "view", workflow.ownerId) || !canWorkflow(actor, "run", workflow.ownerId))
    return "permission";
  if (!workflow.active || workflow.archivedAt !== null) return "paused";
  if (
    run.mode !== "live" ||
    failure.originalResumeAt !== null ||
    !repairableErrors.has(failure.errorId)
  )
    return "unsupported";
  if (
    failure.runId !== run.id ||
    failure.nodeId !== run.nextNodeId ||
    failure.errorId !== run.errorId ||
    failure.retriedAt !== null
  )
    return "inconsistent";
  return null;
}

export async function retryReason(
  db: Db,
  actor: PermSetUser,
  workflow: Workflow,
  run: RetryRun,
  rawDefinition: unknown,
  steps: RetryStep[],
  failure: RunFailure | undefined,
  signal: AbortSignal,
): Promise<RunRetryReason> {
  const fixed = fixedRetryReason(actor, workflow, run, failure);
  if (fixed !== null) return fixed;
  const definition = retryableTaskDefinition(rawDefinition);
  if (definition === null) return "unsupported";
  const cursor = coherentFailedTask(definition, run, steps);
  if (cursor === null) return "inconsistent";
  if (cursor.type === "record.read" && failure?.origin !== "recorded") return "legacy";
  return (await retryTaskReady(db, actor, run.trigger.recordId, signal)) ? "available" : "repair";
}

export async function describeRunRecovery(
  db: Db,
  actor: PermSetUser,
  workflow: Workflow,
  run: RetryRun,
  rawDefinition: unknown,
  steps: RetryStep[],
  failures: RunFailure[],
  signal: AbortSignal,
): Promise<RunRecovery | null> {
  if (run.status !== "failed" && failures.length === 0) return null;
  const open = failures.find((failure) => failure.retriedAt === null);
  const reason = await retryReason(db, actor, workflow, run, rawDefinition, steps, open, signal);
  return {
    eligible: reason === "available",
    failureId: open?.id ?? null,
    reason,
    history: failures.map(
      ({ id, nodeId, errorId, failedAt, origin, originalResumeAt, retriedAt }) => ({
        id,
        nodeId,
        errorId,
        failedAt,
        origin,
        originalResumeAt,
        retriedAt,
      }),
    ),
  };
}
