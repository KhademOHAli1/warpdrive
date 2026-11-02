import type { PgBoss } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { EMAIL_NOTIFICATION_QUEUE } from "@/constants/jobNames";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { dispatchNotificationEmail } from "./notificationDispatch";
import type { NotificationDispatchDependencies } from "./notificationEmailTypes";

export async function runEmailNotificationJob(
  db: Db,
  data: { notificationId: string },
  signal: AbortSignal,
  deps?: NotificationDispatchDependencies,
): Promise<Result<{ sent: boolean }, AppError>> {
  const result = await dispatchNotificationEmail(db, { ...data, signal }, deps);
  if (!result.ok) return result;
  if (result.value.status === "pending")
    return err(
      new AppError(ERROR_IDS.GMAIL_CLAIM_CONTENDED, "Notification delivery remains pending"),
    );
  if (result.value.status === "failed")
    return err(new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Notification delivery was rejected"));
  return ok({ sent: result.value.status === "accepted" });
}

interface NotificationWorkerOptions {
  db: Db;
  dispatchDeps: NotificationDispatchDependencies;
}

// Keep the second formal parameter explicit so integration fixtures fail closed before
// invoking a legacy registrar that could otherwise import the global database.
export async function registerEmailNotificationWorker(
  boss: PgBoss,
  options?: NotificationWorkerOptions,
): Promise<void> {
  const db = options?.db ?? (await import("@/db/client")).db;
  await boss.createQueue(EMAIL_NOTIFICATION_QUEUE);
  await boss.work(
    EMAIL_NOTIFICATION_QUEUE,
    async ([job]: Array<{ data: { notificationId: string } }>) => {
      if (job === undefined) return;
      const signal = AbortSignal.timeout(30_000);
      const result = await runEmailNotificationJob(db, job.data, signal, options?.dispatchDeps);
      if (!result.ok)
        throw new AppError(result.error.id, "Email notification job failed", {
          notificationId: job.data.notificationId,
        });
    },
  );
}
