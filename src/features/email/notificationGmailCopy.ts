import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import { notificationGmailAckMatches } from "./notificationGmailReceipt";
import type { SendPayload } from "./outboxClaim";

interface ReceiptCopy {
  id: string;
  payload: SendPayload;
  from_email: string;
  message_id_header: string;
  sent_at: Date;
  accepted: boolean;
}

interface PrivateThread {
  id: string;
  gmail_thread_id: string | null;
  visibility: string;
  person_id: string | null;
  deal_id: string | null;
  lead_id: string | null;
  has_other_messages: boolean;
}

const copyConflict = () =>
  err(new AppError(ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT, "Gmail notification copy conflicts"));

// A local receipt copy uses a distinct thread identity even when Gmail groups the
// notification into a customer's conversation. Never mutate that conversation.
export async function storeNotificationGmailCopy(
  db: Db,
  args: {
    accountId: string;
    idempotencyKey: string;
    gmailMessageId: string;
    signal: AbortSignal;
  },
): Promise<Result<void, AppError>> {
  const { signal } = args;
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    if (!(await lockReceiptOwner(tx, args.accountId, signal)))
      return err(
        new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "Gmail receipt owner is unavailable"),
      );
    const receipt = (
      await tx.execute(sql`SELECT s.id,s.payload,a.email_address AS from_email,
      s.message_id_header,s.sent_at,${notificationGmailAckMatches()} AS accepted
      FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
      WHERE s.account_id=${args.accountId} AND s.idempotency_key=${args.idempotencyKey}
        AND s.status='sent' AND s.gmail_message_id=${args.gmailMessageId}
      FOR UPDATE OF s`)
    ).rows[0] as ReceiptCopy | undefined;
    signal.throwIfAborted();
    if (receipt?.accepted !== true) return copyConflict();

    const syntheticThreadId = `notification:${receipt.id}`;
    const thread = (
      await tx.execute(sql`SELECT t.id,t.gmail_thread_id,t.visibility,t.person_id,t.deal_id,t.lead_id,
      EXISTS(SELECT 1 FROM email_messages m WHERE m.account_id=t.account_id AND m.thread_id=t.id
        AND (m.gmail_message_id IS DISTINCT FROM ${args.gmailMessageId}
          OR m.provider_message_id IS DISTINCT FROM ${args.gmailMessageId})) AS has_other_messages
      FROM email_threads t WHERE t.account_id=${args.accountId}
        AND t.provider_thread_id=${syntheticThreadId} FOR UPDATE OF t`)
    ).rows[0] as PrivateThread | undefined;
    signal.throwIfAborted();
    if (
      thread !== undefined &&
      (thread.gmail_thread_id !== null ||
        thread.visibility !== "private" ||
        thread.person_id !== null ||
        thread.deal_id !== null ||
        thread.lead_id !== null ||
        thread.has_other_messages)
    )
      return copyConflict();

    const existing = (
      await tx.execute(sql`SELECT id,thread_id,gmail_message_id,provider_message_id,direction
      FROM email_messages WHERE account_id=${args.accountId}
        AND (gmail_message_id=${args.gmailMessageId} OR provider_message_id=${args.gmailMessageId})
      FOR UPDATE`)
    ).rows as {
      id: string;
      thread_id: string;
      gmail_message_id: string | null;
      provider_message_id: string | null;
      direction: string;
    }[];
    signal.throwIfAborted();
    if (existing.length !== 0) {
      const message = existing[0];
      return existing.length === 1 &&
        message?.thread_id === thread?.id &&
        message?.gmail_message_id === args.gmailMessageId &&
        message.provider_message_id === args.gmailMessageId &&
        message.direction === "outbound"
        ? ok(undefined)
        : copyConflict();
    }

    let threadId = thread?.id;
    if (threadId === undefined) {
      const created = (
        await tx.execute(sql`INSERT INTO email_threads
        (account_id,provider_thread_id,subject,visibility,last_message_at)
        VALUES (${args.accountId},${syntheticThreadId},${receipt.payload.subject},'private',${receipt.sent_at})
        ON CONFLICT (account_id,provider_thread_id) DO NOTHING RETURNING id`)
      ).rows[0] as { id: string } | undefined;
      signal.throwIfAborted();
      threadId = created?.id;
    }
    if (threadId === undefined) return copyConflict();
    const payload = receipt.payload;
    const inserted = await tx.execute(sql`INSERT INTO email_messages
      (account_id,thread_id,gmail_message_id,provider_message_id,rfc_message_id,direction,
      from_email,from_name,to_emails,cc_emails,subject,snippet,body_html,body_text,sent_at,tracking_enabled)
      VALUES (${args.accountId},${threadId},${args.gmailMessageId},${args.gmailMessageId},
      ${receipt.message_id_header},'outbound',${receipt.from_email},${payload.fromName ?? null},
      ${JSON.stringify(payload.to)}::jsonb,${JSON.stringify(payload.cc ?? [])}::jsonb,${payload.subject},
      ${Array.from(payload.text ?? payload.subject)
        .slice(0, 200)
        .join("")},
      ${payload.html},${payload.text ?? null},${receipt.sent_at},false)
      ON CONFLICT DO NOTHING RETURNING id`);
    signal.throwIfAborted();
    return inserted.rows.length === 1 ? ok(undefined) : copyConflict();
  });
}

// Receipt repair remains possible after disconnect, but never after offboarding
// or an ownership/provider change. Keep the owner->account lock order.
async function lockReceiptOwner(
  tx: DbOrTx,
  accountId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const pointer = (await tx.execute(sql`SELECT user_id FROM email_accounts WHERE id=${accountId}`))
    .rows[0] as { user_id: string } | undefined;
  signal.throwIfAborted();
  if (pointer === undefined) return false;
  const owner = await tx.execute(sql`SELECT id FROM users
    WHERE id=${pointer.user_id} AND is_active AND invited_at IS NULL FOR NO KEY UPDATE`);
  signal.throwIfAborted();
  if (owner.rows.length !== 1) return false;
  const account = await tx.execute(sql`SELECT id FROM email_accounts
    WHERE id=${accountId} AND user_id=${pointer.user_id} AND provider='gmail' FOR NO KEY UPDATE`);
  signal.throwIfAborted();
  return account.rows.length === 1;
}
