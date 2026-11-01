import type { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { ok, type Result } from "@/types/result";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { smtpAttemptOutcome } from "./smtpOutboxOutcome";
import { checkpointSmtpReceipt, loadSmtpAttempt } from "./smtpOutboxRepo";
import type { SmtpAttempt, SmtpReceipt, SmtpSendOutcome } from "./smtpOutboxTypes";
import { storeSmtpOutboundCopy } from "./smtpStore";
import { appendSmtpSentCopy } from "./smtpStoreSentCopy";

export async function recordAcceptedSmtpSend(
  db: Db,
  args: {
    attempt: SmtpAttempt;
    token: string;
    receipt: SmtpReceipt;
    raw: Buffer;
    runtime: ImapConnectionRuntime;
    idempotencyKey: string;
    signal: AbortSignal;
  },
) {
  let messageId: string | undefined;
  try {
    await checkpointSmtpReceipt(db, {
      attemptId: args.attempt.id,
      token: args.token,
      receipt: args.receipt,
      retrySafe: false,
      signal: args.signal,
    });
    const recorded = await loadSmtpAttempt(
      db,
      args.runtime.accountId,
      args.idempotencyKey,
      args.signal,
    );
    if (recorded === undefined) return review(args.attempt, args.receipt);
    const stored = await storeSmtpOutboundCopy(db, recorded, args.signal);
    if (!stored.ok) return review(recorded, args.receipt);
    messageId = stored.value;
    await appendSmtpSentCopy(db, {
      attempt: recorded,
      runtime: args.runtime,
      messageId,
      raw: args.raw,
      signal: args.signal,
    });
    const final = await loadSmtpAttempt(
      db,
      args.runtime.accountId,
      args.idempotencyKey,
      args.signal,
    );
    return ok(smtpAttemptOutcome(final ?? recorded, messageId));
  } catch {
    args.signal.throwIfAborted();
    return review(args.attempt, args.receipt, messageId);
  }
}

// An accepted email with incomplete local bookkeeping is never presented as a resendable rejection.
function review(attempt: SmtpAttempt, receipt: SmtpReceipt, messageId?: string) {
  const value: SmtpSendOutcome = {
    status: "needs_review",
    providerMessageId: `smtp:${attempt.id}`,
    ...(messageId === undefined ? {} : { messageId }),
    deliveryOutcome: {
      state: receipt.state,
      accepted: receipt.accepted,
      rejected: receipt.rejected,
    },
  };
  return ok(value);
}

export async function repairAcceptedSmtpCopy(
  db: Db,
  attempt: SmtpAttempt,
  signal: AbortSignal,
  rejectUnavailableOwner = false,
): Promise<Result<SmtpSendOutcome, AppError>> {
  const review = { ...smtpAttemptOutcome(attempt), status: "needs_review" as const };
  try {
    const stored = await storeSmtpOutboundCopy(db, attempt, signal);
    if (!stored.ok && rejectUnavailableOwner) return stored;
    return ok(stored.ok ? smtpAttemptOutcome(attempt, stored.value) : review);
  } catch {
    signal.throwIfAborted();
    return ok(review);
  }
}
