import { eq, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { deals, organizations, persons, pipelines } from "@/db/schema";
import type { Activity } from "@/db/schema/activities";

export async function reminderDatabaseNow(tx: Db): Promise<Date> {
  const result = await tx.execute<{ now: Date | string }>(sql`SELECT clock_timestamp() AS now`);
  const value = result.rows[0]?.now;
  const now = value instanceof Date ? value : new Date(value ?? Number.NaN);
  if (!Number.isFinite(now.getTime()))
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing authoritative reminder clock");
  return now;
}

async function lockDealParent(tx: Db, id: string, signal: AbortSignal): Promise<void> {
  const [hint] = await tx
    .select({ pipelineId: deals.pipelineId })
    .from(deals)
    .where(eq(deals.id, id));
  if (hint === undefined) return;
  await tx
    .select({ id: pipelines.id })
    .from(pipelines)
    .where(eq(pipelines.id, hint.pipelineId))
    .for("share");
  const [locked] = await tx
    .select({ pipelineId: deals.pipelineId })
    .from(deals)
    .where(eq(deals.id, id))
    .for("share");
  signal.throwIfAborted();
  // Never acquire a different pipeline after holding the deal. A later retry
  // must read the current parent; a visible moved record is not declared hidden.
  if (locked !== undefined && locked.pipelineId !== hint.pipelineId)
    throw new AppError(
      ERROR_IDS.NOTIF_PRODUCE_FAILED,
      "Reminder parent moved during ordered lock wait",
    );
}

// Authority -> activity -> intent -> pipeline/deal (or person/org). Relevant
// event mutations use the same activity -> intent order before derived deal writes.
export async function lockReminderParent(
  tx: Db,
  activity: Activity,
  signal: AbortSignal,
): Promise<void> {
  if (activity.dealId !== null) return lockDealParent(tx, activity.dealId, signal);
  if (activity.personId !== null) {
    await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.id, activity.personId))
      .for("share");
  } else if (activity.orgId !== null) {
    await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, activity.orgId))
      .for("share");
  }
  signal.throwIfAborted();
}
