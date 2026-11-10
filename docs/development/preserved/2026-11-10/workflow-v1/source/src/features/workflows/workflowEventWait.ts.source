import { and, arrayOverlaps, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { workflowRuns } from "@/db/schema/workflowExecutions";
import { workflowRecordEvents, workflowRecordEventWaits } from "@/db/schema/workflowRecordEvents";
import type { PermSetUser } from "@/features/permissions/effective";
import { err, ok, type Result } from "@/types/result";
import { canWorkflow } from "./access";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import {
  type WorkflowEventWaitConfig,
  workflowEventWaitConfig,
  workflowEventWaitDeadline,
  workflowEventWaitOutput,
} from "./workflowEventWaitContract";
import {
  canExposeWorkflowRecordEvent,
  lockWorkflowRecordEventDeal,
  readVisibleWorkflowRecordEvent,
  type WorkflowRecordEvent,
  type WorkflowRecordEventDealAccess,
  type WorkflowRecordEventTx,
  workflowRecordEventDealVisible,
  workflowRecordEventScope,
} from "./workflowRecordEvent";

const kind: string = "event.wait";
const dealId = z.uuid().toLowerCase();
type Wait = typeof workflowRecordEventWaits.$inferSelect;
type Run = typeof workflowRuns.$inferSelect;
type EventWaitResult<T> = Result<T, string>;
type Progress =
  | { status: "waiting"; armedDeadline?: Date }
  | { status: "completed"; output: StepOutput };

export interface WorkflowEventWaitContext {
  tx: WorkflowRecordEventTx;
  run: Run;
  actor: PermSetUser;
  workflowOwnerId: string;
  node: Pick<WorkflowNode, "id" | "version" | "config"> & { type: string };
  definition: WorkflowDefinition;
  outputs?: RunOutputs;
}

function resolveDeal(
  config: WorkflowEventWaitConfig,
  context: WorkflowEventWaitContext,
): EventWaitResult<string> {
  const binding = config.recordId;
  if (binding.kind === "value") {
    const parsed = dealId.safeParse(binding.value);
    return parsed.success ? ok(parsed.data) : err(ERROR_IDS.WORKFLOW_INVALID);
  }
  const resolved = resolveRunBinding(binding, context.outputs ?? context.run.outputs, {
    definition: context.definition,
    nodeId: context.node.id,
    path: ["recordId"],
  });
  if (resolved.state === "invalid") return err(ERROR_IDS.WORKFLOW_INVALID);
  if (resolved.state !== "value") return err(ERROR_IDS.WORKFLOW_BINDING_MISSING);
  const parsed = dealId.safeParse(resolved.value);
  return parsed.success ? ok(parsed.data) : err(ERROR_IDS.WORKFLOW_INVALID);
}

async function databaseNow(tx: WorkflowRecordEventTx, signal: AbortSignal) {
  const clock = await tx.execute<{ milliseconds: number }>(
    sql`SELECT extract(epoch from clock_timestamp())::double precision * 1000 AS milliseconds`,
  );
  signal.throwIfAborted();
  const now = new Date(clock.rows[0]?.milliseconds ?? Number.NaN);
  return Number.isFinite(now.getTime()) ? now : null;
}

function belongsToWait(event: WorkflowRecordEvent, wait: Wait): boolean {
  return (
    event.recordId === wait.recordId &&
    event.kind === wait.kind &&
    event.sequence > wait.afterSequence &&
    event.occurredAt <= wait.deadline &&
    (wait.watchedFields.length === 0 ||
      wait.watchedFields.some((field) => event.changedFields.includes(field)))
  );
}

function matchesArmedConfig(wait: Wait, config: WorkflowEventWaitConfig): boolean {
  const expected = workflowEventWaitDeadline(wait.armedAt, config.timeoutMinutes);
  const fields = config.updatedFields ?? [];
  const id = config.recordId.kind === "value" ? dealId.safeParse(config.recordId.value) : null;
  return (
    wait.kind === config.event &&
    expected?.getTime() === wait.deadline.getTime() &&
    wait.watchedFields.length === fields.length &&
    fields.every((field) => wait.watchedFields.includes(field)) &&
    (id === null || (id.success && id.data === wait.recordId))
  );
}

async function replay(
  tx: WorkflowRecordEventTx,
  actor: PermSetUser,
  wait: Wait,
  signal: AbortSignal,
): Promise<EventWaitResult<Progress>> {
  if (wait.state === "timed_out")
    return ok({ status: "completed", output: workflowEventWaitOutput(null) });
  if (wait.matchedEventId === null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const event = await readVisibleWorkflowRecordEvent(tx, actor, wait.matchedEventId, signal);
  return event !== null && belongsToWait(event, wait)
    ? ok({ status: "completed", output: workflowEventWaitOutput(event) })
    : err(ERROR_IDS.WORKFLOW_DENIED);
}

async function arm(
  context: WorkflowEventWaitContext,
  config: WorkflowEventWaitConfig,
  recordId: string,
  iterationIndex: number,
  signal: AbortSignal,
): Promise<EventWaitResult<Progress>> {
  const { tx, run, node, actor } = context;
  if (run.status === "waiting") return err(ERROR_IDS.WORKFLOW_INVALID);
  const current = await lockWorkflowRecordEventDeal(tx, recordId, signal);
  if (
    current === undefined ||
    current.deletedAt !== null ||
    !workflowRecordEventDealVisible(actor, current)
  )
    return err(ERROR_IDS.WORKFLOW_DENIED);
  // The producer locks this Deal row before allocating a sequence. While this
  // shared lock is held, no later producer can cross the arm boundary.
  const [last] = await tx
    .select({ sequence: workflowRecordEvents.sequence })
    .from(workflowRecordEvents)
    .where(eq(workflowRecordEvents.recordId, recordId))
    .orderBy(desc(workflowRecordEvents.sequence))
    .limit(1);
  signal.throwIfAborted();
  const armedAt = await databaseNow(tx, signal);
  const deadline =
    armedAt === null ? null : workflowEventWaitDeadline(armedAt, config.timeoutMinutes);
  if (armedAt === null || deadline === null) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  const [waiting] = await tx
    .insert(workflowRecordEventWaits)
    .values({
      runId: run.id,
      nodeId: node.id,
      iterationIndex,
      recordId,
      kind: config.event,
      watchedFields: config.updatedFields ?? [],
      afterSequence: last?.sequence ?? 0n,
      armedAt,
      deadline,
    })
    .onConflictDoNothing({
      target: [
        workflowRecordEventWaits.runId,
        workflowRecordEventWaits.nodeId,
        workflowRecordEventWaits.iterationIndex,
      ],
    })
    .returning({ id: workflowRecordEventWaits.id });
  if (waiting === undefined) return err(ERROR_IDS.WORKFLOW_CONFLICT);
  await tx
    .update(workflowRuns)
    .set({ status: "waiting", resumeAt: deadline, updatedAt: armedAt })
    .where(eq(workflowRuns.id, run.id));
  signal.throwIfAborted();
  return ok({ status: "waiting", armedDeadline: deadline });
}

async function matchingEvent(
  tx: WorkflowRecordEventTx,
  actor: PermSetUser,
  deal: WorkflowRecordEventDealAccess | undefined,
  wait: Wait,
  signal: AbortSignal,
) {
  if (
    deal === undefined ||
    !workflowRecordEventDealVisible(actor, deal) ||
    (wait.kind === "deleted") !== (deal.deletedAt !== null)
  )
    return null;
  const scope = workflowRecordEventScope(deal);
  const [event] = await tx
    .select()
    .from(workflowRecordEvents)
    .where(
      and(
        eq(workflowRecordEvents.recordId, wait.recordId),
        eq(workflowRecordEvents.kind, wait.kind),
        gt(workflowRecordEvents.sequence, wait.afterSequence),
        lte(workflowRecordEvents.occurredAt, wait.deadline),
        eq(workflowRecordEvents.afterScope, scope),
        or(isNull(workflowRecordEvents.beforeScope), eq(workflowRecordEvents.beforeScope, scope)),
        wait.kind === "deleted" ? eq(workflowRecordEvents.eventId, deal.writeVersion) : undefined,
        wait.watchedFields.length > 0
          ? arrayOverlaps(workflowRecordEvents.changedFields, wait.watchedFields)
          : undefined,
      ),
    )
    .orderBy(asc(workflowRecordEvents.sequence))
    .limit(1);
  signal.throwIfAborted();
  return event !== undefined &&
    canExposeWorkflowRecordEvent(actor, deal, event) &&
    belongsToWait(event, wait)
    ? event
    : null;
}

async function resume(
  context: WorkflowEventWaitContext,
  wait: Wait,
  signal: AbortSignal,
): Promise<EventWaitResult<Progress>> {
  const { tx, run, actor } = context;
  if (wait.state !== "waiting") return replay(tx, actor, wait, signal);
  if (run.status !== "waiting" || run.resumeAt?.getTime() !== wait.deadline.getTime())
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const deal = await lockWorkflowRecordEventDeal(tx, wait.recordId, signal);
  const now = await databaseNow(tx, signal);
  if (now === null) return err(ERROR_IDS.WORKFLOW_WRITE_FAILED);
  const event = await matchingEvent(tx, actor, deal, wait, signal);
  if (event === null && now < wait.deadline) return ok({ status: "waiting" });
  const [settled] = await tx
    .update(workflowRecordEventWaits)
    .set({
      state: event === null ? "timed_out" : "event",
      matchedEventId: event?.eventId ?? null,
      finishedAt: new Date(Math.max(now.getTime(), wait.armedAt.getTime())),
    })
    .where(
      and(eq(workflowRecordEventWaits.id, wait.id), eq(workflowRecordEventWaits.state, "waiting")),
    )
    .returning({ id: workflowRecordEventWaits.id });
  signal.throwIfAborted();
  return settled === undefined
    ? err(ERROR_IDS.WORKFLOW_CONFLICT)
    : ok({ status: "completed", output: workflowEventWaitOutput(event) });
}

// The shared worker holds the run row lock. The event/timeout receipt and the
// completed step/cursor must commit in this SAME transaction. A producer
// never takes workflow/run locks, which preserves the lock ordering here.
export async function advanceWorkflowEventWait(
  context: WorkflowEventWaitContext,
  signal: AbortSignal,
): Promise<EventWaitResult<Progress>> {
  signal.throwIfAborted();
  const { tx, node, run, actor, workflowOwnerId } = context;
  if (run.mode !== "live") return err(ERROR_IDS.WORKFLOW_NOT_READY);
  if (
    node.type !== kind ||
    node.version !== 1 ||
    run.nextNodeId !== node.id ||
    run.actorId !== actor.id ||
    !canWorkflow(actor, "run", workflowOwnerId) ||
    (run.status !== "queued" && run.status !== "running" && run.status !== "waiting")
  )
    return err(ERROR_IDS.WORKFLOW_DENIED);
  const config = workflowEventWaitConfig.safeParse(node.config);
  if (!config.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const iterationIndex = run.iteratorFrame?.itemIndex ?? -1;
  const [wait] = await tx
    .select()
    .from(workflowRecordEventWaits)
    .where(
      and(
        eq(workflowRecordEventWaits.runId, run.id),
        eq(workflowRecordEventWaits.nodeId, node.id),
        eq(workflowRecordEventWaits.iterationIndex, iterationIndex),
      ),
    );
  signal.throwIfAborted();
  if (wait !== undefined)
    return matchesArmedConfig(wait, config.data)
      ? resume(context, wait, signal)
      : err(ERROR_IDS.WORKFLOW_INVALID);
  const record = resolveDeal(config.data, context);
  return record.ok ? arm(context, config.data, record.value, iterationIndex, signal) : record;
}
