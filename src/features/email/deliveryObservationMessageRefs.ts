import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { emailMessages, emailThreads } from "@/db/schema/email";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { lockDeliveryObservationReader } from "./deliveryObservationAuthority";
import { lockDeliveryObservationAccount } from "./deliveryObservationScope";
import { notificationGmailAckMatches } from "./notificationGmailReceipt";

export type DeliveryObservationMessageRef =
  | { kind: "source"; sourceMessageId: string }
  | { kind: "attempt"; attemptId: string };

const associatedRowSchema = z.strictObject({
  message_id: z.guid(),
  attempt_id: z.guid(),
  account_id: z.guid(),
  message_id_header: z.string(),
  payload_text: z.string(),
  attempt_snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
});

async function associatedAttemptRefs(
  tx: DbOrTx,
  input: { actor: AuthUser; accountId: string },
  messageIds: string[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const result = await tx.execute(sql`WITH candidates AS (
    SELECT m.id AS message_id,s.id AS attempt_id,s.account_id,s.message_id_header,
      s.payload,s.payload::text AS payload_text,count(*) OVER (PARTITION BY m.id) AS matches
    FROM email_messages m
    JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
    JOIN email_accounts a ON a.id=m.account_id
    JOIN email_send_attempts s ON s.account_id=m.account_id
      AND s.provider_message_id=m.provider_message_id
    WHERE m.account_id=${input.accountId} AND m.id IN (${sql.join(
      messageIds.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND a.user_id=${input.actor.id} AND m.direction='outbound' AND t.trashed_at IS NULL
      AND s.payload_prepared=true AND s.send_started_at IS NOT NULL
      AND ((a.provider='imap_smtp' AND m.provider_message_id='smtp:'||s.id::text)
        OR (a.provider='gmail' AND m.gmail_message_id IS NOT NULL AND m.gmail_message_id<>''
          AND m.gmail_message_id=m.provider_message_id AND s.gmail_message_id=m.gmail_message_id
          AND CASE WHEN t.provider_thread_id LIKE 'notification:%' OR s.payload ? 'systemPurpose'
            THEN (${notificationGmailAckMatches()} AND s.status='sent'
              AND t.provider_thread_id='notification:'||s.id::text AND t.gmail_thread_id IS NULL
              AND t.visibility='private' AND t.person_id IS NULL AND t.deal_id IS NULL AND t.lead_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM email_messages other
                WHERE other.account_id=m.account_id AND other.thread_id=t.id AND other.id<>m.id))
            ELSE true END))
  ) SELECT c.message_id,c.attempt_id,c.account_id,c.message_id_header,c.payload_text,r.attempt_snapshot_hash
    FROM candidates c
    JOIN email_delivery_reviews r ON r.account_id=c.account_id AND r.attempt_id=c.attempt_id
    JOIN email_delivery_reports d ON d.id=r.report_id AND d.account_id=r.account_id
    JOIN email_messages source ON source.id=d.source_message_id AND source.account_id=d.account_id
    JOIN email_threads source_thread ON source_thread.id=source.thread_id AND source_thread.account_id=source.account_id
    WHERE c.matches=1 AND r.decision='associate' AND source.direction='inbound'
      AND source_thread.trashed_at IS NULL
      AND r.recipient_index<jsonb_array_length(d.parsed->'recipients')
      AND NOT EXISTS (SELECT 1 FROM email_delivery_reviews newer
        WHERE newer.report_id=r.report_id AND newer.recipient_index=r.recipient_index
          AND newer.revision>r.revision)
      AND jsonb_typeof(c.payload->(r.recipient_snapshot->>'kind'))='array'
      AND (c.payload->(r.recipient_snapshot->>'kind')) @> jsonb_build_array(r.recipient_snapshot->>'address')`);
  signal.throwIfAborted();
  const rows = z.array(associatedRowSchema).safeParse(result.rows);
  if (!rows.success) return [];
  return rows.data.filter(
    (row) =>
      createHash("sha256")
        .update(
          JSON.stringify([row.account_id, row.attempt_id, row.message_id_header, row.payload_text]),
        )
        .digest("hex") === row.attempt_snapshot_hash,
  );
}

// Reader hints carry no report content and grant no authority to the private HTTP boundary.
// Keep ordinary messages quiet unless a stored, currently visible report can actually render.
export async function readDeliveryObservationMessageRefs(
  db: DbOrTx,
  input: { actor: AuthUser; accountId: string; messageIds: readonly string[] },
  signal: AbortSignal,
): Promise<ReadonlyMap<string, DeliveryObservationMessageRef | null>> {
  signal.throwIfAborted();
  const refs = new Map<string, DeliveryObservationMessageRef | null>(
    input.messageIds.map((messageId) => [messageId, null]),
  );
  if (
    !input.actor.isActive ||
    input.messageIds.length === 0 ||
    !z.guid().safeParse(input.accountId).success ||
    !z.array(z.guid()).safeParse(input.messageIds).success
  )
    return refs;
  await db.transaction(async (tx) => {
    if (
      !(await lockDeliveryObservationReader(tx, input.actor.id, signal)) ||
      !(await lockDeliveryObservationAccount(tx, input.actor.id, input.accountId, signal))
    )
      return;
    const messages = await tx
      .select({
        id: emailMessages.id,
        direction: emailMessages.direction,
        hasReport: sql<boolean>`EXISTS (SELECT 1 FROM email_delivery_reports d
        WHERE d.source_message_id=${emailMessages.id} AND d.account_id=${emailMessages.accountId})`,
      })
      .from(emailMessages)
      .innerJoin(
        emailThreads,
        and(
          eq(emailThreads.id, emailMessages.threadId),
          eq(emailThreads.accountId, emailMessages.accountId),
        ),
      )
      .where(
        and(
          eq(emailMessages.accountId, input.accountId),
          inArray(emailMessages.id, [...refs.keys()]),
          isNull(emailThreads.trashedAt),
        ),
      )
      .for("share", { of: [emailThreads, emailMessages] });
    signal.throwIfAborted();
    for (const message of messages) {
      if (message.direction === "inbound" && message.hasReport)
        refs.set(message.id, { kind: "source", sourceMessageId: message.id });
    }
    const outboundIds = messages
      .filter((message) => message.direction === "outbound")
      .map((message) => message.id);
    if (outboundIds.length === 0) return;
    const associated = await associatedAttemptRefs(tx, input, outboundIds, signal);
    signal.throwIfAborted();
    for (const row of associated)
      refs.set(row.message_id, { kind: "attempt", attemptId: row.attempt_id });
  });
  signal.throwIfAborted();
  return refs;
}
