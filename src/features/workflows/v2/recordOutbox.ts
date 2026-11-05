import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workflowV2RecordEvents } from "@/db/schema/workflowV2Events";
import type { WorkflowV2Adapters } from "@/features/blocks/contracts";
import {
  admitWorkflowV2Event,
  type EventProjection,
  resumeWorkflowV2Event,
  type WorkflowV2Event,
} from "./events";
import { projectNativeEvent } from "./nativeEvents";

async function claim(db: Db, now: Date) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(workflowV2RecordEvents)
      .where(
        or(
          eq(workflowV2RecordEvents.status, "pending"),
          and(
            eq(workflowV2RecordEvents.status, "claimed"),
            lt(workflowV2RecordEvents.leaseUntil, now),
          ),
        ),
      )
      .orderBy(workflowV2RecordEvents.createdAt)
      .limit(1)
      .for("update", { skipLocked: true });
    if (row === undefined) return null;
    const [claimed] = await tx
      .update(workflowV2RecordEvents)
      .set({
        status: "claimed",
        attempts: row.attempts + 1,
        leaseUntil: new Date(now.getTime() + 60_000),
      })
      .where(eq(workflowV2RecordEvents.id, row.id))
      .returning();
    return claimed ?? null;
  });
}
type EventRow = typeof workflowV2RecordEvents.$inferSelect;
function fence(row: EventRow) {
  return and(
    eq(workflowV2RecordEvents.id, row.id),
    eq(workflowV2RecordEvents.status, "claimed"),
    eq(workflowV2RecordEvents.attempts, row.attempts),
  );
}
async function deliver(
  db: Db,
  row: EventRow,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
): Promise<string[]> {
  const event: WorkflowV2Event = {
    eventKey: row.id,
    eventName: row.eventName,
    recordId: row.recordId,
    changedFields: row.changedFields,
    payload: {},
    originRunId: row.originRunId,
    occurredAt: row.createdAt,
  };
  const project: EventProjection = (tx, actor, _event, innerSignal) =>
    projectNativeEvent(
      tx,
      actor,
      {
        entity: row.entity,
        id: row.recordId,
        eventName: row.eventName,
        before: row.before,
        after: row.after,
        changedFields: row.changedFields,
      },
      innerSignal,
    );
  try {
    const admitted = await admitWorkflowV2Event(db, event, adapters, project, signal);
    const resumed = await resumeWorkflowV2Event(db, event, adapters, project, signal);
    await db
      .update(workflowV2RecordEvents)
      .set({
        status: "delivered",
        deliveredAt: new Date(),
        leaseUntil: null,
        before: null,
        after: null,
        errorId: null,
      })
      .where(fence(row));
    return [...admitted, ...resumed];
  } catch (error) {
    const terminal = row.attempts >= 5;
    await db
      .update(workflowV2RecordEvents)
      .set({
        status: terminal ? "failed" : "pending",
        leaseUntil: null,
        errorId: "E_WORKFLOW_V2_EVENT_PROCESSING",
        ...(terminal ? { before: null, after: null, deliveredAt: new Date() } : {}),
      })
      .where(fence(row));
    if (signal.aborted) throw error;
    return [];
  }
}
export async function drainWorkflowV2RecordOutbox(
  db: Db,
  adapters: WorkflowV2Adapters,
  signal: AbortSignal,
  limit = 50,
): Promise<string[]> {
  const ids = new Set<string>();
  for (let index = 0; index < Math.min(limit, 100); index++) {
    signal.throwIfAborted();
    const row = await claim(db, new Date());
    if (row === null) break;
    for (const id of await deliver(db, row, adapters, signal)) ids.add(id);
  }
  return [...ids];
}
