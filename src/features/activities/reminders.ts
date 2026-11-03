import type { Job, PgBoss } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { PGBOSS_QUEUE_ACTIVITY_REMINDER, REMINDER_LEAD_MINUTES } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { db as prodDb } from "@/db/client";
import { enqueueEmailNotification } from "@/features/notifications/emailDispatch";
import { requireBoss } from "@/jobs/requireBoss";
import { processActivityReminder } from "./reminderDelivery";
import { activityReminderJobV1, legacyActivityReminderNudge } from "./reminderIntentTypes";
import {
  NATIVE_ACTIVITY_REMINDER_QUEUE,
  NATIVE_ACTIVITY_REMINDER_RECONCILE_QUEUE,
  reconcileActivityReminders,
} from "./reminderScheduling";

interface ReminderJob {
  data: unknown;
}
function reminderTarget(raw: unknown): { activityId: string; generationId: string | undefined } {
  const native = activityReminderJobV1.safeParse(raw);
  if (native.success) return native.data;
  const legacy = legacyActivityReminderNudge.safeParse(raw);
  if (!legacy.success)
    throw new AppError(
      ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID,
      "Unsupported reminder job protocol",
    );
  return { activityId: legacy.data.activityId, generationId: undefined };
}

// Existing legacy producer. Native Calendar uses durable managed intent instead.
// A singleton key is a scheduling hint, not a logical notification receipt.
export async function scheduleReminder(
  activityId: string,
  dueAt: Date | null,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (dueAt === null) return;
  const boss = requireBoss();
  if (boss === null) return;
  const fireAt = new Date(dueAt.getTime() - REMINDER_LEAD_MINUTES * 60_000);
  await boss.send(
    PGBOSS_QUEUE_ACTIVITY_REMINDER,
    { activityId },
    { startAfter: fireAt, singletonKey: activityId },
  );
}

// Versioned native job or legacy nudge. The same activity lock chooses the
// current path: managed delivery is in-app only; legacy email enqueue remains
// after the local transaction and outside the authority fence.
export async function handleReminderJob(
  db: Db,
  job: ReminderJob,
  signal: AbortSignal,
): Promise<void> {
  const { activityId, generationId } = reminderTarget(job.data);
  const outcome = await processActivityReminder(db, activityId, generationId, signal);
  if (outcome.legacyReschedule !== undefined)
    await scheduleReminder(
      outcome.legacyReschedule.activityId,
      outcome.legacyReschedule.dueAt,
      signal,
    );
  if (outcome.legacyNotification !== undefined)
    await enqueueEmailNotification(
      db,
      outcome.legacyNotification.notificationId,
      outcome.legacyNotification.recipientId,
      "activity_reminder",
      signal,
    );
}

// Register the pg-boss worker that processes activity-reminder jobs.
// Follows the exact pattern in src/features/email/workerJobs.ts (job ARRAY
// destructure). If handleReminderJob throws (DB error), the error propagates
// so pg-boss applies its retry/backoff.
export async function registerReminderWorker(boss: PgBoss, db: Db = prodDb): Promise<void> {
  await boss.createQueue(PGBOSS_QUEUE_ACTIVITY_REMINDER);
  await boss.createQueue(NATIVE_ACTIVITY_REMINDER_QUEUE);
  await boss.createQueue(NATIVE_ACTIVITY_REMINDER_RECONCILE_QUEUE);
  const deliver = async (jobs: Job<unknown>[]) => {
    for (const job of jobs) await handleReminderJob(db, job, AbortSignal.timeout(30_000));
  };
  await boss.work(PGBOSS_QUEUE_ACTIVITY_REMINDER, deliver);
  await boss.work(NATIVE_ACTIVITY_REMINDER_QUEUE, deliver);
  await boss.work(NATIVE_ACTIVITY_REMINDER_RECONCILE_QUEUE, () =>
    reconcileActivityReminders(db, boss, AbortSignal.timeout(30_000)),
  );
  await boss.schedule(NATIVE_ACTIVITY_REMINDER_RECONCILE_QUEUE, "* * * * *", { v: 1 });
  await boss.send(NATIVE_ACTIVITY_REMINDER_RECONCILE_QUEUE, { v: 1 }, { singletonKey: "boot" });
}
