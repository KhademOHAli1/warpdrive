import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { notificationGmailAckMatches } from "@/features/email/notificationGmailReceipt";
import type { PreparedNotificationEmail } from "./notificationEmailTypes";

export async function notificationDispatchSuppressed(
  db: Db,
  attempt: PreparedNotificationEmail,
  signal: AbortSignal,
): Promise<boolean> {
  const row = (
    await db.execute(sql`SELECT notification_suppressed_at IS NOT NULL AS suppressed
    FROM email_send_attempts WHERE id=${attempt.attemptId} AND account_id=${attempt.accountId}`)
  ).rows[0] as { suppressed: boolean } | undefined;
  signal.throwIfAborted();
  return row?.suppressed === true;
}

// A queue acknowledgement follows provider certainty and a completed private CRM copy.
// The immutable purpose also prevents a changed canonical recipient from adopting a receipt.
export async function markNotificationAccepted(
  db: Db,
  attempt: PreparedNotificationEmail,
  signal: AbortSignal,
): Promise<boolean> {
  const changed =
    await db.execute(sql`UPDATE notifications n SET email_sent_at=coalesce(n.email_sent_at,now())
    FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
    WHERE n.id=${attempt.idempotencyKey} AND n.user_id=${attempt.recipientUserId}
      AND n.user_id=a.user_id AND s.id=${attempt.attemptId} AND s.account_id=${attempt.accountId}
      AND s.idempotency_key=n.id AND s.status='sent'
      AND s.payload->'systemPurpose'=${JSON.stringify({ version: 1, kind: "notification", notificationId: attempt.idempotencyKey, recipientUserId: attempt.recipientUserId })}::jsonb
      AND ((a.provider='imap_smtp' AND s.delivery_outcome->>'state'='accepted')
        OR (${notificationGmailAckMatches()}))
      AND EXISTS(SELECT 1 FROM email_messages m JOIN email_threads t
        ON t.id=m.thread_id AND t.account_id=m.account_id
        WHERE m.account_id=s.account_id AND t.visibility='private' AND t.deal_id IS NULL AND t.person_id IS NULL
          AND (m.provider_message_id=s.provider_message_id
            OR (a.provider='gmail' AND m.gmail_message_id=s.gmail_message_id)))
    RETURNING n.id`);
  signal.throwIfAborted();
  return changed.rows.length === 1;
}
