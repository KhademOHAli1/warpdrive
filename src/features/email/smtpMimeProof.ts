import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { CLAIM_LEASE_SECONDS } from "@/constants/email";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { RawParsedMail } from "./providers/rawMimeTypes";

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const addresses = (values: { email: string }[]) =>
  values.map((value) => value.email.toLowerCase()).sort();

export function smtpSemanticFingerprint(parsed: RawParsedMail): string {
  return digest(
    JSON.stringify({
      messageId: parsed.rfcMessageId,
      date: parsed.date?.toISOString() ?? null,
      from: addresses(parsed.from),
      to: addresses(parsed.to),
      cc: addresses(parsed.cc),
      subject: parsed.subject,
      text: parsed.text,
      html: parsed.htmlWithRemoteImages,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      attachments: parsed.attachments.map((part) => ({
        filename: part.filename,
        type: part.contentType,
        disposition: part.disposition,
        contentId: part.contentId,
        size: part.size,
        hash: digest(part.content),
      })),
    }),
  );
}

interface SentCopyCandidate {
  accountId: string;
  isSentFolder: boolean;
  parsed: RawParsedMail;
  signal: AbortSignal;
}
export type SmtpSentCopyProof =
  | { kind: "matched"; messageId: string }
  | { kind: "pending" }
  | { kind: "unmatched" };

// An autosaved copy can arrive before SMTP acknowledgment or the repairable CRM transaction.
export async function inspectSmtpSentCopy(
  db: DbOrTx,
  args: SentCopyCandidate,
): Promise<SmtpSentCopyProof> {
  args.signal.throwIfAborted();
  if (
    !args.isSentFolder ||
    args.parsed.warpdriveSendAttemptId === null ||
    args.parsed.rfcMessageId === null
  )
    return { kind: "unmatched" };
  const result = await db.execute(sql`SELECT m.id,s.delivery_outcome->>'state' AS state,
    (s.status='sending' AND s.claim_token IS NOT NULL AND s.send_started_at IS NOT NULL
      AND s.claimed_at>now()-(${CLAIM_LEASE_SECONDS}*interval '1 second')) AS in_flight
    FROM email_send_attempts s LEFT JOIN email_messages m
      ON m.account_id=s.account_id AND m.provider_message_id=s.provider_message_id
    WHERE s.account_id=${args.accountId} AND s.id=${args.parsed.warpdriveSendAttemptId}::uuid
      AND s.message_id_header=${args.parsed.rfcMessageId}
      AND s.delivery_outcome->>'semanticFingerprint'=${smtpSemanticFingerprint(args.parsed)}`);
  args.signal.throwIfAborted();
  const row = result.rows[0] as
    | { id: string | null; state: string | null; in_flight: boolean | null }
    | undefined;
  if (row === undefined) return { kind: "unmatched" };
  if (row.state === "accepted" || row.state === "partial")
    return row.id === null ? { kind: "pending" } : { kind: "matched", messageId: row.id };
  return row.in_flight === true ? { kind: "pending" } : { kind: "unmatched" };
}

// Header and RFC ID are untrusted hints. Only the qualified receipt and semantic content prove identity.
export async function findSmtpSentCopy(
  db: DbOrTx,
  args: SentCopyCandidate,
): Promise<string | null> {
  const proof = await inspectSmtpSentCopy(db, args);
  return proof.kind === "matched" ? proof.messageId : null;
}
