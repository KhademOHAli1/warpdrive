import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { parseNotificationSendPurpose } from "@/features/email/mailSendPurpose";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { notificationSubmissionPolicy } from "./notificationAdmissionPolicy";
import {
  lockNotificationAttempt,
  lockNotificationAuthority,
  notificationAdmissionContended,
  notificationAdmissionPointer,
  notificationPurposeValue,
  suppressNotificationAttempt,
} from "./notificationAdmissionState";
import type {
  NotificationAdmissionArgs,
  NotificationAdmissionState,
} from "./notificationAdmissionTypes";

export { notificationAdmissionContended } from "./notificationAdmissionState";
export type { NotificationAdmissionState } from "./notificationAdmissionTypes";

// Must run on the short provider stamp transaction, never around network I/O.
// A NOWAIT error is deliberately caught only by the owner of this transaction.
export async function admitNotificationSubmission(
  tx: DbOrTx,
  args: NotificationAdmissionArgs,
): Promise<NotificationAdmissionState> {
  args.signal.throwIfAborted();
  const pointer = await notificationAdmissionPointer(tx, args);
  if (pointer === undefined) return "missing";
  if (!notificationPurposeValue(pointer.payload).present) return "ordinary";
  const authority = await lockNotificationAuthority(tx, args, pointer.owner_id);
  if (authority === null) return "deferred";
  const attempt = await lockNotificationAttempt(tx, args);
  if (attempt === undefined) return "missing";
  if (!attempt.unsubmitted) return "retained";
  if (attempt.suppressed) return "suppressed";
  const rawPurpose = notificationPurposeValue(attempt.payload);
  const purpose = parseNotificationSendPurpose(rawPurpose.value);
  if (
    purpose === null ||
    purpose.recipientUserId !== authority.ownerId ||
    purpose.notificationId !== attempt.idempotency_key
  ) {
    return (await suppressNotificationAttempt(tx, args, "purpose_invalid"))
      ? "suppressed"
      : "retained";
  }
  const policy = await notificationSubmissionPolicy(tx, purpose, authority, args.signal);
  if (policy.state !== "suppressed") return policy.state;
  return (await suppressNotificationAttempt(tx, args, policy.reason)) ? "suppressed" : "retained";
}

// Worker preflight is separate from the final stamp: it suppresses unavailable
// recipients before the legacy owner gate and makes contended work retryable.
export async function admitNotificationAttempt(
  db: Db,
  args: { accountId: string; idempotencyKey: string; signal: AbortSignal },
): Promise<Result<NotificationAdmissionState, AppError>> {
  const { signal } = args;
  signal.throwIfAborted();
  try {
    const state = await db.transaction(
      async (tx): Promise<NotificationAdmissionState> => {
        const pointer = (
          await tx.execute(sql`SELECT id FROM email_send_attempts
        WHERE account_id=${args.accountId} AND idempotency_key=${args.idempotencyKey}`)
        ).rows[0] as { id: string } | undefined;
        signal.throwIfAborted();
        return pointer === undefined
          ? "missing"
          : admitNotificationSubmission(tx, {
              accountId: args.accountId,
              attemptId: pointer.id,
              signal,
            });
      },
      { isolationLevel: "read committed" },
    );
    signal.throwIfAborted();
    return ok(state);
  } catch (error) {
    signal.throwIfAborted();
    if (notificationAdmissionContended(error)) return ok("deferred");
    return err(
      error instanceof AppError
        ? error
        : new AppError(
            ERROR_IDS.DB_WRITE_FAILED,
            "Notification submission policy could not be checked",
          ),
    );
  }
}
