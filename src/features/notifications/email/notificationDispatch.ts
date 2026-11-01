import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { runSendJob } from "@/features/email/worker";
import { err, ok, type Result } from "@/types/result";
import { prepareNotificationEmail } from "./notificationBinding";
import {
  markNotificationAccepted,
  notificationDispatchSuppressed,
} from "./notificationDispatchState";
import type {
  NotificationDispatchDependencies,
  NotificationDispatchOutcome,
  NotificationEmailInput,
} from "./notificationEmailTypes";

export async function dispatchNotificationEmail(
  db: Db,
  input: NotificationEmailInput,
  deps?: NotificationDispatchDependencies,
): Promise<Result<NotificationDispatchOutcome, AppError>> {
  const { signal } = input;
  signal.throwIfAborted();
  try {
    const prepared = await prepareNotificationEmail(db, input);
    if (!prepared.ok) return prepared;
    if (prepared.value.status !== "prepared") return ok(prepared.value);
    const attempt = prepared.value;
    const sent = await runSendJob(
      db,
      {
        accountId: attempt.accountId,
        idempotencyKey: attempt.idempotencyKey,
        signal,
      },
      deps,
    );
    signal.throwIfAborted();
    if (await notificationDispatchSuppressed(db, attempt, signal))
      return ok({ status: "suppressed", reason: "suppressed" });
    if (!sent.ok) {
      if (sent.error.id === ERROR_IDS.GMAIL_CLAIM_CONTENDED)
        return ok({ status: "pending", attemptId: attempt.attemptId });
      return sent;
    }
    if (sent.value.status === "sent") {
      const accepted = await markNotificationAccepted(db, attempt, signal);
      return ok({ status: accepted ? "accepted" : "needs_review", attemptId: attempt.attemptId });
    }
    const status =
      sent.value.status === "needs_review" || sent.value.status === "failed"
        ? sent.value.status
        : "pending";
    return ok({ status, attemptId: attempt.attemptId });
  } catch (error) {
    signal.throwIfAborted();
    return err(
      error instanceof AppError
        ? error
        : new AppError(ERROR_IDS.DB_WRITE_FAILED, "Notification delivery could not be completed"),
    );
  }
}
