import type { AppError } from "@/constants/errorIds";
import type { SyncDeps } from "@/features/email/worker";
import type { Result } from "@/types/result";

export interface NotificationEmailInput {
  notificationId: string;
  signal: AbortSignal;
}

export interface PreparedNotificationEmail {
  status: "prepared";
  attemptId: string;
  accountId: string;
  idempotencyKey: string;
  recipientUserId: string;
}

export type NotificationEmailSkip = {
  status: "skipped" | "suppressed";
  reason:
    | "missing"
    | "accepted"
    | "recipient"
    | "preference"
    | "visibility"
    | "mailbox"
    | "suppressed";
};

export type NotificationPreparation = Result<
  PreparedNotificationEmail | NotificationEmailSkip,
  AppError
>;
export type NotificationDispatchDependencies = SyncDeps;
export type NotificationDispatchOutcome =
  | NotificationEmailSkip
  | {
      status: "pending" | "accepted" | "needs_review" | "failed";
      attemptId: string;
    };
