import { and, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { emailAccounts, emailMessages, emailSendAttempts, emailThreads } from "@/db/schema/email";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { notificationGmailAckMatches } from "./notificationGmailReceipt";

// These aliases also bind the shared canonical notification ACK predicate.
const attempt = alias(emailSendAttempts, "s");
const account = alias(emailAccounts, "a");
const copy = alias(emailMessages, "m");
const thread = alias(emailThreads, "t");

const authoritativeCopy = sql`(
  (${account.provider}='imap_smtp' AND ${copy.providerMessageId}='smtp:'||${attempt.id}::text)
  OR (${account.provider}='gmail' AND ${copy.gmailMessageId} IS NOT NULL
    AND ${copy.gmailMessageId}<>'' AND ${copy.gmailMessageId}=${copy.providerMessageId}
    AND ${attempt.gmailMessageId}=${copy.gmailMessageId}
    AND CASE WHEN ${thread.providerThreadId} LIKE 'notification:%' OR ${attempt.payload} ? 'systemPurpose'
      THEN (${notificationGmailAckMatches()} AND ${attempt.status}='sent'
        AND ${thread.providerThreadId}='notification:'||${attempt.id}::text
        AND ${thread.gmailThreadId} IS NULL AND ${thread.visibility}='private'
        AND ${thread.personId} IS NULL AND ${thread.dealId} IS NULL AND ${thread.leadId} IS NULL
        AND NOT EXISTS (SELECT 1 FROM email_messages other
          WHERE other.account_id=${copy.accountId} AND other.thread_id=${thread.id} AND other.id<>${copy.id}))
      ELSE NOT EXISTS (SELECT 1 FROM email_send_attempts competing
        WHERE competing.account_id=${attempt.accountId} AND competing.id<>${attempt.id}
          AND competing.payload_prepared=true AND competing.send_started_at IS NOT NULL
          AND competing.provider_message_id=${copy.providerMessageId}
          AND competing.gmail_message_id=${copy.gmailMessageId}
          AND NOT (competing.payload ? 'systemPurpose')) END))`;

// Only a genuinely detached attempt may use its live exact provider copy. Every joined
// row is nonnullable, so PostgreSQL can lock the copy, thread and attempt together.
export async function readDetachedDeliveryObservationTargets(
  tx: DbOrTx,
  accountId: string,
  signal: AbortSignal,
  filter: SQL | undefined,
  limit: number,
  requireSubmitted: boolean,
) {
  signal.throwIfAborted();
  const selectedAttempts = tx
    .select({ id: emailSendAttempts.id })
    .from(emailSendAttempts)
    .where(filter);
  const rows = await tx
    .select({
      id: attempt.id,
      accountId: attempt.accountId,
      messageIdHeader: attempt.messageIdHeader,
      payload: attempt.payload,
      payloadText: sql<string>`${attempt.payload}::text`,
      sendStartedAt: attempt.sendStartedAt,
      sentAt: attempt.sentAt,
      copyMessageId: copy.id,
    })
    .from(attempt)
    .innerJoin(account, eq(account.id, attempt.accountId))
    .innerJoin(
      copy,
      and(
        eq(copy.accountId, attempt.accountId),
        eq(copy.providerMessageId, attempt.providerMessageId),
      ),
    )
    .innerJoin(thread, and(eq(thread.id, copy.threadId), eq(thread.accountId, copy.accountId)))
    .where(
      and(
        eq(attempt.accountId, accountId),
        isNull(attempt.threadId),
        eq(copy.direction, "outbound"),
        isNull(thread.trashedAt),
        inArray(attempt.id, selectedAttempts),
        authoritativeCopy,
        requireSubmitted
          ? and(eq(attempt.payloadPrepared, true), isNotNull(attempt.sendStartedAt))
          : undefined,
      ),
    )
    .orderBy(desc(attempt.sendStartedAt), attempt.id, copy.id)
    .limit(limit * 2)
    .for("share", { of: [attempt, copy, thread] });
  signal.throwIfAborted();
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.id, (counts.get(row.id) ?? 0) + 1);
  return rows.filter((row) => counts.get(row.id) === 1).slice(0, limit);
}
