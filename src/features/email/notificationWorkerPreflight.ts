import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { admitNotificationAttempt } from "@/features/notifications/email/notificationAdmission";
import { ok, type Result } from "@/types/result";
import { repairKnownNotificationGmail } from "./notificationGmailLocalRepair";

export async function notificationWorkerPreflight(
  db: Db,
  args: { accountId: string; idempotencyKey: string; signal: AbortSignal },
): Promise<Result<{ status: string }, AppError> | null> {
  const notification = await admitNotificationAttempt(db, args);
  if (!notification.ok) return notification;
  switch (notification.value) {
    case "deferred":
      return ok({ status: "pending" });
    case "suppressed":
      return ok({ status: "suppressed" });
    case "retained":
      return repairKnownNotificationGmail(db, args);
    case "ordinary":
    case "admitted":
    case "missing":
      return null;
  }
}
