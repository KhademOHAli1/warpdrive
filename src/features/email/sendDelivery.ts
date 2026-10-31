import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { StorageClient } from "@/features/files/storage";
import type { SendEmailOutcome } from "@/types/mail";
import { err, ok, type Result } from "@/types/result";
import type { GmailClient } from "./gmailClient";
import { readGmailConnection } from "./gmailConnectionFence";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { processSendAttempt } from "./outbox";
import { loadAttempt } from "./outboxClaim";
import { sendFailureOutcome } from "./sendFailureOutcome";
import { sendIndependent } from "./sendIndependent";
import { prepareEnqueuedSend } from "./sendPreparation";
import { ensureLocalCopyForReplay } from "./sendReplayRepair";
import { enqueueScheduledSendJob, isFutureScheduledSend } from "./sendScheduling";
import { disableTokens } from "./tracking";
import { performWorkerSendCrm } from "./workerSendCrm";

export interface SendDeliveryArgs {
  accountId: string;
  idempotencyKey: string;
  attemptId: string;
  actorId: string;
  fromEmail: string;
  signal: AbortSignal;
  storage: StorageClient;
  gmail?: GmailClient;
  mail?: ImapConnectionRuntime;
  expectedGeneration?: number;
}

function acceptedReview(
  args: SendDeliveryArgs,
  providerMessageId?: string,
): Result<SendEmailOutcome, AppError> {
  return ok({
    status: "needs_review",
    attemptId: args.attemptId,
    providerMessageId,
    deliveryOutcome: { state: providerMessageId !== undefined ? "accepted" : "unknown" },
  });
}

export async function deliverQueuedSend(
  db: Db,
  args: SendDeliveryArgs,
): Promise<Result<SendEmailOutcome, AppError>> {
  const prepared = await prepareEnqueuedSend(db, args);
  if (!prepared.ok) return sendFailureOutcome(db, args, prepared.error);
  const scheduledAt = prepared.value.scheduledAt;
  if (scheduledAt && isFutureScheduledSend(scheduledAt, Date.now())) {
    await enqueueScheduledSendJob(args.accountId, args.idempotencyKey, scheduledAt);
    return ok({ status: "scheduled", attemptId: args.attemptId });
  }
  if (args.mail) return sendIndependent(db, { ...args, runtime: args.mail });
  if (!args.gmail)
    return err(
      new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "mailbox transport unavailable"),
    );
  const existing = await loadAttempt(db, args.accountId, args.idempotencyKey);
  if (existing?.status === "sent") {
    try {
      const repaired = await ensureLocalCopyForReplay(db, { ...args, gmail: args.gmail });
      return repaired.ok
        ? ok({
            status: "sent",
            messageId: repaired.value.messageId,
            providerMessageId: repaired.value.messageId,
            attemptId: args.attemptId,
          })
        : acceptedReview(args, existing.gmail_message_id ?? undefined);
    } catch {
      args.signal.throwIfAborted();
      return acceptedReview(args, existing.gmail_message_id ?? undefined);
    }
  }
  const outcome = await processSendAttempt(db, { ...args, gmail: args.gmail });
  if (!outcome.ok) return sendFailureOutcome(db, args, outcome.error);
  if (outcome.value.status === "sent" && outcome.value.gmailMessageId !== undefined) {
    const providerMessageId = outcome.value.gmailMessageId;
    return completeGmailDelivery(
      db,
      { ...args, gmail: args.gmail },
      providerMessageId,
      existing?.connection_generation ?? args.expectedGeneration,
    );
  }
  const current = await loadAttempt(db, args.accountId, args.idempotencyKey);
  if (current?.send_started_at != null || outcome.value.status === "needs_review")
    return acceptedReview(args);
  await disableTokens(db, args.attemptId, args.signal);
  return ok({
    status: outcome.value.status,
    attemptId: args.attemptId,
    deliveryOutcome: { state: "rejected" },
  });
}

async function completeGmailDelivery(
  db: Db,
  args: SendDeliveryArgs & { gmail: GmailClient },
  providerMessageId: string,
  generation?: number,
): Promise<Result<SendEmailOutcome, AppError>> {
  try {
    if (!(await readGmailConnection(db, args.accountId, args.signal, generation)))
      return acceptedReview(args, providerMessageId);
    const stored = await performWorkerSendCrm(db, { ...args, gmailMessageId: providerMessageId });
    return stored.ok
      ? ok({
          status: "sent",
          messageId: providerMessageId,
          providerMessageId,
          attemptId: args.attemptId,
        })
      : acceptedReview(args, providerMessageId);
  } catch {
    args.signal.throwIfAborted();
    return acceptedReview(args, providerMessageId);
  }
}
