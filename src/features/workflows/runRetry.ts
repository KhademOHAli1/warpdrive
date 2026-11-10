import { and, eq, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  workflowRunFailures,
  workflowRuns,
  workflowSteps,
  workflows,
  workflowVersions,
} from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import { type RetryRun, retryReason, retryTaskReady } from "./runRecovery";
import { currentRetryActor } from "./runRetrySession";
import type { RetrySessionRef } from "./runRetryTypes";
import { workflowManualLaunchPayload } from "./workflowManualLaunchContract";

export const retryWorkflowInput = z.strictObject({
  runId: z.uuid(),
  failureId: z.uuid(),
  requestKey: z.uuid(),
});
type Input = z.infer<typeof retryWorkflowInput>;
type Workflow = typeof workflows.$inferSelect;
type RetryResult = Result<{ id: string; replayed: boolean }, string>;
interface RetryContext {
  run: RetryRun;
  actor: PermSetUser;
  workflow: Workflow;
  recordId: string;
}

function canInspectRetry(actor: PermSetUser, workflow: Workflow, runActorId: string) {
  return (
    actor.id === runActorId &&
    workflow.archivedAt === null &&
    canWorkflow(actor, "view", workflow.ownerId) &&
    canWorkflow(actor, "run", workflow.ownerId)
  );
}

function duplicateRetryKey(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if (
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      current.constraint === "workflow_run_retry_request_unique"
    )
      return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function lockedContext(
  db: Db,
  who: RetrySessionRef,
  input: Input,
  signal: AbortSignal,
): Promise<Result<RetryContext, string>> {
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, input.runId))
    .for("update");
  signal.throwIfAborted();
  if (run === undefined || run.actorId !== who.userId) return err(ERROR_IDS.WORKFLOW_DENIED);
  const actor = await currentRetryActor(db, who, signal);
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, run.workflowId));
  if (actor === null || workflow === undefined || !canInspectRetry(actor, workflow, run.actorId))
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const launch = workflowManualLaunchPayload.safeParse(run.trigger);
  if (!launch.success || !("recordId" in launch.data)) return err(ERROR_IDS.WORKFLOW_NOT_READY);
  return ok({ run, actor, workflow, recordId: launch.data.recordId });
}

async function replayReceipt(
  db: Db,
  context: RetryContext,
  input: Input,
): Promise<RetryResult | null> {
  const [receipt] = await db
    .select()
    .from(workflowRunFailures)
    .where(
      and(
        eq(workflowRunFailures.retriedBy, context.actor.id),
        eq(workflowRunFailures.retryRequestKey, input.requestKey),
      ),
    );
  if (receipt === undefined) return null;
  return receipt.runId === context.run.id && receipt.id === input.failureId
    ? ok({ id: context.run.id, replayed: true })
    : err(ERROR_IDS.WORKFLOW_CONFLICT);
}

async function reactivateTask(
  db: Db,
  context: RetryContext,
  input: Input,
  signal: AbortSignal,
): Promise<RetryResult> {
  const { run, actor, workflow } = context;
  const [failure] = await db
    .select()
    .from(workflowRunFailures)
    .where(and(eq(workflowRunFailures.id, input.failureId), eq(workflowRunFailures.runId, run.id)));
  if (run.status !== "failed" || failure === undefined || failure.retriedAt !== null)
    return err(ERROR_IDS.WORKFLOW_CONFLICT);
  const [version] = await db
    .select()
    .from(workflowVersions)
    .where(
      and(eq(workflowVersions.id, run.versionId), eq(workflowVersions.workflowId, run.workflowId)),
    );
  const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.runId, run.id));
  const reason = await retryReason(
    db,
    actor,
    workflow,
    run,
    version?.definition,
    steps,
    failure,
    signal,
  );
  if (reason !== "available")
    return err(
      reason === "permission" || reason === "actor"
        ? ERROR_IDS.WORKFLOW_DENIED
        : ERROR_IDS.WORKFLOW_NOT_READY,
    );
  const clock = await db.execute<{ milliseconds: number }>(
    sql`SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds`,
  );
  const now = new Date(clock.rows[0]?.milliseconds ?? Number.NaN);
  if (!Number.isFinite(now.getTime())) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  const [consumed] = await db
    .update(workflowRunFailures)
    .set({ retryRequestKey: input.requestKey, retriedBy: actor.id, retriedAt: now })
    .where(and(eq(workflowRunFailures.id, failure.id), isNull(workflowRunFailures.retriedAt)))
    .returning({ id: workflowRunFailures.id });
  if (consumed === undefined) return err(ERROR_IDS.WORKFLOW_CONFLICT);
  await db
    .update(workflowRuns)
    .set({ status: "queued", errorId: null, updatedAt: now })
    .where(eq(workflowRuns.id, run.id));
  return ok({ id: run.id, replayed: false });
}

async function stillAuthorized(
  db: Db,
  who: RetrySessionRef,
  { run, recordId }: RetryContext,
  replayed: boolean,
  signal: AbortSignal,
) {
  const actor = await currentRetryActor(db, who, signal);
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, run.workflowId));
  if (actor === null || workflow === undefined || !canInspectRetry(actor, workflow, run.actorId))
    return false;
  if (!replayed && (!workflow.active || !(await retryTaskReady(db, actor, recordId, signal))))
    return false;
  const finalActor = await currentRetryActor(db, who, signal);
  return finalActor !== null && sameAuthority(actor, finalActor);
}

function sameSet(left: ReadonlySet<string> | undefined, right: ReadonlySet<string> | undefined) {
  const a = left ?? new Set<string>();
  const b = right ?? new Set<string>();
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function sameAuthority(left: PermSetUser, right: PermSetUser) {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.isActive === right.isActive &&
    sameSet(left.flags, right.flags) &&
    sameSet(left.groupIds, right.groupIds) &&
    sameSet(left.managedUserIds, right.managedUserIds)
  );
}

// One row lock owns failure consumption, retry receipt and cursor reactivation.
// Only the native server context may supply `who`; serialized command fields
// cannot choose an actor, session, version, cursor, output or replacement graph.
export async function retryWorkflowRun(
  db: Db,
  who: RetrySessionRef,
  raw: unknown,
  signal: AbortSignal,
): Promise<RetryResult> {
  signal.throwIfAborted();
  const parsed = retryWorkflowInput.safeParse(raw);
  if (!parsed.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const rollbackState = { denied: false };
  try {
    return await db.transaction(
      async (tx) => {
        const isolation = await tx.execute<{ value: string }>(
          sql`SELECT current_setting('transaction_isolation') AS value`,
        );
        if (isolation.rows[0]?.value !== "read committed")
          throw new AppError(ERROR_IDS.DB_INVARIANT, "Workflow retry requires read committed");
        const context = await lockedContext(tx, who, parsed.data, signal);
        if (!context.ok) return context;
        const replay = await replayReceipt(tx, context.value, parsed.data);
        const result = replay ?? (await reactivateTask(tx, context.value, parsed.data, signal));
        if (!result.ok) return result;
        // A unique-key wait or prerequisite read must not carry stale request
        // authority through commit. Denial rolls BOTH receipt and reactivation back.
        if (!(await stillAuthorized(tx, who, context.value, result.value.replayed, signal))) {
          rollbackState.denied = true;
          tx.rollback();
        }
        signal.throwIfAborted();
        return result;
      },
      { isolationLevel: "read committed" },
    );
  } catch (error) {
    if (rollbackState.denied && error instanceof TransactionRollbackError)
      return err(ERROR_IDS.WORKFLOW_DENIED);
    if (duplicateRetryKey(error)) return err(ERROR_IDS.WORKFLOW_CONFLICT);
    throw error;
  }
}
