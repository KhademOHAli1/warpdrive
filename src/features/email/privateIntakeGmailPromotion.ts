import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";

interface HeldObservation {
  id: string;
  owned_message_id: string | null;
  intake_state: string;
  content_state: string;
  revision: number;
  baseline_thread_id: string;
  baseline_message_hash: string;
  baseline_thread_hash: string;
  baseline_attachments_hash: string;
}

// The caller already locked the mailbox owner/account and exact canonical ACK
// attempt. Promotion changes only this ledger's unchanged, exclusive own copy.
export async function promotePrivateGmailObservation(
  tx: DbOrTx,
  args: { accountId: string; providerMessageId: string; attemptId: string; signal: AbortSignal },
): Promise<"absent" | "promoted" | "conflict"> {
  const { signal } = args;
  signal.throwIfAborted();
  const held = (
    await tx.execute(sql`SELECT * FROM email_private_intake
    WHERE account_id=${args.accountId} AND provider='gmail'
      AND observed_provider_id=${args.providerMessageId} FOR UPDATE`)
  ).rows[0] as HeldObservation | undefined;
  signal.throwIfAborted();
  if (held === undefined) return "absent";
  if (held.content_state !== "retained" || held.owned_message_id === null) return "conflict";
  if (held.intake_state === "confirmed_notification") return "absent";
  if (held.intake_state !== "unverified") return "conflict";
  const syntheticId = `private-intake:${held.id}`;
  const notificationId = `notification:${args.attemptId}`;
  const copy = (
    await tx.execute(sql`SELECT m.id FROM email_messages m
    JOIN email_threads t ON t.id=m.thread_id AND t.account_id=m.account_id
    WHERE m.id=${held.owned_message_id} AND m.account_id=${args.accountId}
      AND m.thread_id=${held.baseline_thread_id} AND m.provider_message_id=${syntheticId}
      AND m.gmail_message_id IS NULL AND m.message_fingerprint IS NULL
      AND t.provider_thread_id=${syntheticId} AND t.gmail_thread_id IS NULL
      AND t.visibility='private' AND t.person_id IS NULL AND t.deal_id IS NULL AND t.lead_id IS NULL
      AND t.trashed_at IS NULL AND t.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM email_messages other WHERE other.account_id=m.account_id
        AND other.thread_id=m.thread_id AND other.id<>m.id)
    FOR UPDATE OF m,t`)
  ).rows[0];
  await tx.execute(sql`SELECT id FROM email_message_attachments
    WHERE message_id=${held.owned_message_id} AND account_id=${args.accountId} FOR UPDATE`);
  signal.throwIfAborted();
  const baseline = (
    await tx.execute(sql`SELECT * FROM public.private_intake_baseline_v1(
    ${args.accountId}::uuid,${held.owned_message_id}::uuid)`)
  ).rows[0] as { message_hash: string; thread_hash: string; attachments_hash: string } | undefined;
  const collision = await tx.execute(sql`SELECT 1 FROM email_messages m
    WHERE m.account_id=${args.accountId} AND m.id<>${held.owned_message_id}
      AND (m.gmail_message_id=${args.providerMessageId} OR m.provider_message_id=${args.providerMessageId})
    UNION ALL SELECT 1 FROM email_threads t WHERE t.account_id=${args.accountId}
      AND t.id<>${held.baseline_thread_id} AND t.provider_thread_id=${notificationId} LIMIT 1`);
  signal.throwIfAborted();
  if (
    copy === undefined ||
    baseline?.message_hash !== held.baseline_message_hash ||
    baseline.thread_hash !== held.baseline_thread_hash ||
    baseline.attachments_hash !== held.baseline_attachments_hash ||
    collision.rows.length !== 0
  ) {
    await tx.execute(sql`UPDATE email_private_intake SET intake_state='conflict',revision=revision+1
      WHERE id=${held.id} AND revision=${held.revision}`);
    signal.throwIfAborted();
    return "conflict";
  }
  const confirmed = await tx.execute(sql`UPDATE email_private_intake i
    SET intake_state='confirmed_notification',confirmation_attempt_id=s.id,
      confirmation_snapshot=jsonb_build_object('version',1,'accountId',i.account_id::text,
        'attemptId',s.id::text,'providerMessageId',i.observed_provider_id,
        'payloadHash',public.private_intake_hash_v1(s.payload)),revision=i.revision+1
    FROM email_send_attempts s WHERE i.id=${held.id} AND i.revision=${held.revision}
      AND s.id=${args.attemptId} AND s.account_id=i.account_id RETURNING i.id`);
  signal.throwIfAborted();
  if (confirmed.rows.length !== 1) return "conflict";
  await tx.execute(sql`UPDATE email_threads SET provider_thread_id=${notificationId}
    WHERE id=${held.baseline_thread_id} AND account_id=${args.accountId}`);
  await tx.execute(sql`UPDATE email_messages SET gmail_message_id=${args.providerMessageId},
    provider_message_id=${args.providerMessageId},direction='outbound',tracking_enabled=false
    WHERE id=${held.owned_message_id} AND account_id=${args.accountId}`);
  signal.throwIfAborted();
  return "promoted";
}
