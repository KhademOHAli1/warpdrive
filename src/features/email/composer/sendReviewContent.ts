import type { SendEmailOutcome } from "@/types/mail";
import type { ComposerMailboxMessages } from "./mailboxMessages";
export function sendReviewContent(
  outcome: SendEmailOutcome,
  L: ComposerMailboxMessages,
): { title: string; description: string } {
  if (outcome.sentCopy !== undefined && outcome.sentCopy.state !== "complete")
    return {
      title: L.sentCopyTitle,
      description: outcome.sentCopy.state === "failed" ? L.sentCopyFailed : L.sentCopyUnknown,
    };
  const state = outcome.deliveryOutcome?.state;
  if (state === "partial") return { title: L.partialTitle, description: L.partialDescription };
  if (state === "unknown") return { title: L.unknownTitle, description: L.unknownDescription };
  if (state === "accepted" && outcome.messageId === undefined)
    return { title: L.acceptedReviewTitle, description: L.acceptedReviewDescription };
  if (outcome.status === "sent" || state === "accepted")
    return { title: L.alreadySentTitle, description: L.alreadySentDescription };
  if (outcome.status === "failed" || state === "rejected")
    return { title: L.rejectedTitle, description: L.rejectedDescription };
  if (outcome.status === "scheduled")
    return { title: L.scheduledTitle, description: L.scheduledDescription };
  if (outcome.status === "pending" || outcome.status === "sending")
    return { title: L.pendingTitle, description: L.pendingDescription };
  return { title: L.unknownTitle, description: L.unknownDescription };
}
