import type { SmtpAttempt, SmtpSendOutcome } from "./smtpOutboxTypes";

export function smtpAttemptOutcome(attempt: SmtpAttempt, messageId?: string): SmtpSendOutcome {
  const receipt = attempt.delivery_outcome;
  const copy = receipt?.sentCopy;
  return {
    ...(copy === undefined
      ? {}
      : {
          sentCopy: {
            state: copy.state === "started" ? "unknown" : copy.state,
            folderPath: copy.folderPath,
          },
        }),
    status:
      receipt?.state === "accepted"
        ? "sent"
        : receipt?.state === "partial" || receipt?.state === "unknown"
          ? "needs_review"
          : "failed",
    ...(attempt.provider_message_id === null
      ? {}
      : { providerMessageId: attempt.provider_message_id }),
    ...(messageId === undefined ? {} : { messageId }),
    ...(receipt === null
      ? {}
      : {
          deliveryOutcome: {
            state: receipt.state,
            accepted: receipt.accepted,
            rejected: receipt.rejected,
          },
        }),
  };
}
