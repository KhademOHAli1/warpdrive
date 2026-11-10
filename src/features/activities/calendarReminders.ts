import type { Job, PgBoss } from "pg-boss";
import { PGBOSS_QUEUE_CALENDAR_REMINDER, PGBOSS_QUEUE_REMINDER_OUTBOX } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { db as prodDb } from "@/db/client";
import { getBoss } from "@/jobs/boss";
import { deliverReminderIntent } from "./calendarReminderDelivery";
import { dispatchReminderIntents } from "./reminderOutbox";

export async function handleCalendarReminderJob(
  db: Db,
  job: { data: unknown },
  signal: AbortSignal,
  boss: PgBoss | null = getBoss(),
): Promise<void> {
  await deliverReminderIntent(db, job.data, signal, boss);
}

export async function registerCalendarReminderWorker(boss: PgBoss, db: Db = prodDb): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_CALENDAR_REMINDER);
  await boss.work(PGBOSS_QUEUE_CALENDAR_REMINDER, async ([job]: Job<{ intentId: string }>[]) => {
    if (job === undefined) return;
    await handleCalendarReminderJob(db, job, AbortSignal.timeout(30_000), boss);
  });
  await boss.createQueue(PGBOSS_QUEUE_REMINDER_OUTBOX);
  await boss.work(PGBOSS_QUEUE_REMINDER_OUTBOX, async () => {
    await dispatchReminderIntents(db, boss, AbortSignal.timeout(30_000));
  });
  await boss.schedule(PGBOSS_QUEUE_REMINDER_OUTBOX, "* * * * *");
  await boss.send(PGBOSS_QUEUE_REMINDER_OUTBOX, {});
}
