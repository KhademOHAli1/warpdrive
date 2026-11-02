import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { parseRawMime } from "./providers/rawMime";
import { buildSmtpMime } from "./smtpMime";
import { smtpSemanticFingerprint } from "./smtpMimeProof";
import { recordAcceptedSmtpSend } from "./smtpOutboxAccepted";
import { prepareSmtpArtifacts } from "./smtpOutboxArtifacts";
import { checkpointSmtpReceipt, releaseSmtpClaim, stampSmtpSubmission } from "./smtpOutboxRepo";
import type { SmtpAttempt, SmtpOutboxArgs, SmtpReceipt, SmtpSendOutcome } from "./smtpOutboxTypes";

export async function submitClaimedSmtpAttempt(
  db: Db,
  args: SmtpOutboxArgs,
  attempt: SmtpAttempt,
  token: string,
): Promise<Result<SmtpSendOutcome, AppError>> {
  const artifacts = await prepareSmtpArtifacts(db, {
    attempt,
    token,
    storage: args.storage,
    signal: args.signal,
  });
  if (!artifacts.ok) {
    await releaseSmtpClaim(db, attempt.id, token, args.signal);
    return artifacts;
  }
  const date = new Date();
  const references = [...(attempt.parent_references ?? [])];
  if (attempt.in_reply_to !== null && !references.includes(attempt.in_reply_to))
    references.push(attempt.in_reply_to);
  const mime = await buildSmtpMime({
    attemptId: attempt.id,
    messageId: attempt.message_id_header,
    from: attempt.from_email,
    payload: attempt.payload,
    date,
    inReplyTo: attempt.in_reply_to,
    references,
    preparedAttachments: artifacts.value,
    storage: args.storage,
    signal: args.signal,
  });
  if (!mime.ok) {
    await releaseSmtpClaim(db, attempt.id, token, args.signal);
    return mime;
  }
  const parsed = await parseRawMime({ source: mime.value, signal: args.signal });
  if (!parsed.ok) {
    await releaseSmtpClaim(db, attempt.id, token, args.signal);
    return err(new AppError(ERROR_IDS.MAIL_SEND_REJECTED, "Email exceeds supported MIME limits"));
  }
  const prepared: SmtpReceipt = {
    state: "unknown",
    preparedAttachments: artifacts.value,
    inReplyTo: attempt.in_reply_to,
    references,
    semanticFingerprint: smtpSemanticFingerprint(parsed.value),
    mimeDate: date.toISOString(),
  };
  const sent = await args.runtime.smtp.sendRaw({
    from: attempt.from_email,
    to: [...attempt.payload.to, ...(attempt.payload.cc ?? []), ...(attempt.payload.bcc ?? [])],
    raw: mime.value,
    signal: args.signal,
    beforeSubmission: (signal) =>
      stampSmtpSubmission(db, { attempt, token, runtime: args.runtime, receipt: prepared, signal }),
  });
  if (!sent.ok) {
    const rejected: SmtpReceipt = {
      ...prepared,
      state: sent.error.retrySafe ? "rejected" : "unknown",
    };
    await checkpointSmtpReceipt(db, {
      attemptId: attempt.id,
      token,
      receipt: rejected,
      retrySafe: sent.error.retrySafe,
      signal: args.signal,
    });
    if (sent.error.kind === "connection_changed")
      return err(
        new AppError(
          ERROR_IDS.MAIL_CONNECTION_CHANGED,
          "Mailbox connection changed before submission",
        ),
      );
    return ok({
      status: sent.error.retrySafe ? "failed" : "needs_review",
      deliveryOutcome: { state: rejected.state },
    });
  }
  const accepted: SmtpReceipt = {
    ...prepared,
    state: sent.value.partial ? "partial" : "accepted",
    accepted: sent.value.accepted,
    rejected: sent.value.rejected,
  };
  return recordAcceptedSmtpSend(db, {
    attempt,
    token,
    receipt: accepted,
    raw: mime.value,
    runtime: args.runtime,
    idempotencyKey: args.idempotencyKey,
    signal: args.signal,
  });
}
