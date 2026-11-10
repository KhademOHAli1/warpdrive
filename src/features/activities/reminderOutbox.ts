import { and, eq, isNull, lte } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { PGBOSS_QUEUE_ACTIVITY_REMINDER } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { calendarReminderIntents } from "@/db/schema";
import { handoffReminderEmail } from "./reminderEmailHandoff";
import { processReminderRebuilds } from "./reminderRebuild";

const DISPATCH_BATCH_SIZE = 100;
type ReminderIntent = typeof calendarReminderIntents.$inferSelect;

async function enqueueReminder(boss: PgBoss, intent: ReminderIntent, signal: AbortSignal) {
  await boss.send(
    PGBOSS_QUEUE_ACTIVITY_REMINDER,
    { intentId: intent.id },
    {
      id: intent.id,
      startAfter: intent.fireAt,
      retryLimit: 10,
      retryDelay: 30,
      retryBackoff: true,
    },
  );
  signal.throwIfAborted();
}

async function recoverReminderJob(
  boss: PgBoss,
  intent: ReminderIntent,
  signal: AbortSignal,
): Promise<boolean> {
  const job = await boss.getJobById(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
  signal.throwIfAborted();
  if (job === null || job.state === "completed") {
    // Completed work may have run before fireAt. A lost handoff can be retried with the same UUID.
    if (job !== null) {
      await boss.deleteJob(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
      signal.throwIfAborted();
    }
    await enqueueReminder(boss, intent, signal);
    return true;
  }
  if (job.state === "failed") {
    await boss.retry(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
    signal.throwIfAborted();
    return true;
  }
  if (job.state === "cancelled") {
    await boss.resume(PGBOSS_QUEUE_ACTIVITY_REMINDER, intent.id);
    signal.throwIfAborted();
    return true;
  }
  return false;
}

async function recoverDispatchedReminders(db: Db, boss: PgBoss, signal: AbortSignal) {
  return db.transaction(async (tx) => {
    const dispatched = await tx
      .select()
      .from(calendarReminderIntents)
      .where(
        and(
          eq(calendarReminderIntents.state, "dispatched"),
          isNull(calendarReminderIntents.deliveredAt),
          lte(calendarReminderIntents.fireAt, new Date()),
        ),
      )
      .orderBy(calendarReminderIntents.dispatchedAt, calendarReminderIntents.id)
      .limit(DISPATCH_BATCH_SIZE)
      .for("update", { skipLocked: true });
    signal.throwIfAborted();
    let recovered = 0;
    for (const intent of dispatched) {
      if (await recoverReminderJob(boss, intent, signal)) recovered += 1;
      // Rotate live jobs as well so a full batch of active/retrying jobs cannot starve later rows.
      await tx
        .update(calendarReminderIntents)
        .set({ dispatchedAt: new Date() })
        .where(eq(calendarReminderIntents.id, intent.id));
      signal.throwIfAborted();
    }
    return recovered;
  });
}

export async function dispatchReminderIntents(
  db: Db,
  boss: PgBoss,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  await processReminderRebuilds(db, signal);
  await boss.createQueue(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  signal.throwIfAborted();
  const count = await db.transaction(async (tx) => {
    const pending = await tx
      .select()
      .from(calendarReminderIntents)
      .where(eq(calendarReminderIntents.state, "pending"))
      .orderBy(calendarReminderIntents.fireAt)
      .limit(DISPATCH_BATCH_SIZE)
      .for("update", { skipLocked: true });
    signal.throwIfAborted();
    for (const intent of pending) {
      await enqueueReminder(boss, intent, signal);
      await tx
        .update(calendarReminderIntents)
        .set({ state: "dispatched", dispatchedAt: new Date() })
        .where(eq(calendarReminderIntents.id, intent.id));
      signal.throwIfAborted();
    }
    return pending.length;
  });
  const recovered = await recoverDispatchedReminders(db, boss, signal);
  const deliveries = await db
    .select({ id: calendarReminderIntents.id })
    .from(calendarReminderIntents)
    .where(
      and(
        eq(calendarReminderIntents.state, "delivered"),
        isNull(calendarReminderIntents.emailEnqueuedAt),
      ),
    )
    .orderBy(calendarReminderIntents.deliveredAt)
    .limit(DISPATCH_BATCH_SIZE);
  signal.throwIfAborted();
  for (const delivery of deliveries) await handoffReminderEmail(db, boss, delivery.id, signal);
  return count + recovered;
}
