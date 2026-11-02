import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type { NotificationSendPurpose } from "./mailSendPurpose";
import type { SendPayload } from "./outboxClaim";
import type { SendOutcome } from "./outboxReconcile";

// Queries using these predicates bind s to the attempt and a to its mailbox.
// A public RFC header or a search result is never acceptance evidence.
function canonicalNotificationGmailPurpose() {
  return sql`a.provider='gmail' AND s.thread_id IS NULL
    AND s.payload->'systemPurpose'=jsonb_build_object('version',1,'kind','notification',
      'notificationId',s.idempotency_key::text,'recipientUserId',a.user_id::text)`;
}

export function notificationGmailAckMatches() {
  return sql`(${canonicalNotificationGmailPurpose()}
    AND s.send_started_at IS NOT NULL AND s.sent_at IS NOT NULL
    AND s.gmail_message_id IS NOT NULL AND s.gmail_message_id<>''
    AND s.provider_message_id=s.gmail_message_id
    AND s.delivery_outcome=jsonb_build_object('version',1,'provider','gmail',
      'state','accepted','evidence','api_ack','providerMessageId',s.gmail_message_id))`;
}

// Persist only the ID returned by this sendRaw call, bound to the payload sent.
// The API call has already finished; no authority or data lock spans network IO.
export async function recordNotificationGmailAck(
  db: Db,
  args: {
    attemptId: string;
    accountId: string;
    idempotencyKey: string;
    purpose: NotificationSendPurpose;
    payload: SendPayload;
    providerMessageId: string;
    signal: AbortSignal;
  },
): Promise<Result<void, AppError>> {
  args.signal.throwIfAborted();
  if (args.providerMessageId.length === 0)
    return err(new AppError(ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT, "Gmail ACK has no ID"));
  const proof = {
    version: 1,
    provider: "gmail",
    state: "accepted",
    evidence: "api_ack",
    providerMessageId: args.providerMessageId,
  };
  const changed = await db.execute(sql`UPDATE email_send_attempts s
    SET status='sent',gmail_message_id=${args.providerMessageId},
      provider_message_id=${args.providerMessageId},delivery_outcome=${JSON.stringify(proof)}::jsonb,
      sent_at=coalesce(s.sent_at,now()),error_id=NULL
    FROM email_accounts a
    WHERE s.id=${args.attemptId} AND s.account_id=${args.accountId}
      AND s.idempotency_key=${args.idempotencyKey} AND a.id=s.account_id
      AND ${canonicalNotificationGmailPurpose()}
      AND s.payload->'systemPurpose'=${JSON.stringify(args.purpose)}::jsonb
      AND s.payload=${JSON.stringify(args.payload)}::jsonb
      AND s.send_started_at IS NOT NULL
      AND (s.gmail_message_id IS NULL OR s.gmail_message_id=${args.providerMessageId})
      AND (s.provider_message_id IS NULL OR s.provider_message_id=${args.providerMessageId})
    RETURNING s.id`);
  args.signal.throwIfAborted();
  return changed.rows.length === 1
    ? ok(undefined)
    : err(new AppError(ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT, "Gmail notification ACK conflicts"));
}

// A stamped private attempt is never retried or adopted through RFC search.
// Rechecking proof in the UPDATE also preserves an ACK committed concurrently.
export async function reconcileNotificationGmail(
  db: Db,
  attemptId: string,
  signal: AbortSignal,
): Promise<SendOutcome | null> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`UPDATE email_send_attempts s
    SET status=CASE WHEN ${notificationGmailAckMatches()} THEN 'sent'::email_send_status
        ELSE 'needs_review'::email_send_status END,
      error_id=CASE WHEN ${notificationGmailAckMatches()} THEN NULL ELSE 'E_GMAIL_004' END
    FROM email_accounts a WHERE s.id=${attemptId} AND a.id=s.account_id
      AND s.payload ? 'systemPurpose'
    RETURNING s.status,s.gmail_message_id`)
  ).rows[0] as { status: "sent" | "needs_review"; gmail_message_id: string | null } | undefined;
  signal.throwIfAborted();
  if (row === undefined) return null;
  return row.status === "sent"
    ? { status: "sent", gmailMessageId: row.gmail_message_id ?? undefined }
    : { status: "needs_review" };
}

// Intake runs this under the existing mailbox fence before touching provider threads.
// Receipt repair owns the local copy, so sync can safely leave this message alone.
export async function isAcceptedNotificationGmailId(
  tx: DbOrTx,
  accountId: string,
  providerMessageId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT s.id FROM email_send_attempts s
    JOIN email_accounts a ON a.id=s.account_id
    WHERE s.account_id=${accountId} AND s.status='sent'
      AND s.gmail_message_id=${providerMessageId} AND ${notificationGmailAckMatches()}`);
  signal.throwIfAborted();
  return rows.rows.length !== 0;
}
