import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { ImapThreadOperationValue } from "./imapThreadOperationsTypes";
import type { ReadIntentReceipt } from "./readIntentTypes";

export function readIntentRemoteFailureResult(
  result: Result<ImapThreadOperationValue, AppError>,
  receipt: ReadIntentReceipt | null,
): Result<ImapThreadOperationValue, AppError> {
  // Every caller has a durable admission. Missing disposition is unresolved even
  // when this process stopped before I/O; another caller cannot take its claim.
  if (receipt?.state === "applied") return ok({ threadId: receipt.threadId, readIntent: receipt });
  if (receipt?.state === "denied") {
    if (!result.ok && result.error.id === receipt.errorId) return result;
    return err(new AppError(receipt.errorId ?? ERROR_IDS.MAIL_CAPABILITY_DENIED, "Read denied"));
  }
  return err(
    new AppError(
      receipt?.state === "unknown" && receipt.errorId === ERROR_IDS.MAIL_WRITE_PARTIAL
        ? ERROR_IDS.MAIL_WRITE_PARTIAL
        : ERROR_IDS.MAIL_WRITE_UNKNOWN,
      "Read not confirmed",
    ),
  );
}
