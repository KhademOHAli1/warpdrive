import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type {
  NotificationAdmissionArgs,
  NotificationAdmissionAttempt,
  NotificationAdmissionAuthority,
  NotificationAdmissionPointer,
  NotificationSuppressionReason,
} from "./notificationAdmissionTypes";

const MAX_CAUSE_DEPTH = 8;
// A missing stamp alone is insufficient: legacy/uncertain receipts remain pinned.
const provenUnsubmitted = sql`s.send_started_at IS NULL AND s.sent_at IS NULL
  AND s.gmail_message_id IS NULL AND s.provider_message_id IS NULL
  AND s.status IN ('pending','sending','failed')
  AND (s.delivery_outcome IS NULL OR (s.delivery_outcome->>'state'='rejected'
    AND coalesce(s.delivery_outcome->'accepted','[]'::jsonb)='[]'::jsonb))`;

export function notificationPurposeValue(payload: unknown): { present: boolean; value: unknown } {
  if (typeof payload !== "object" || payload === null || !Object.hasOwn(payload, "systemPurpose"))
    return { present: false, value: undefined };
  return { present: true, value: Reflect.get(payload, "systemPurpose") };
}

export async function notificationAdmissionPointer(
  tx: DbOrTx,
  args: NotificationAdmissionArgs,
): Promise<NotificationAdmissionPointer | undefined> {
  const rows = await tx.execute(sql`SELECT s.id,s.payload,a.user_id AS owner_id
    FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
    WHERE s.id=${args.attemptId} AND s.account_id=${args.accountId}`);
  args.signal.throwIfAborted();
  return rows.rows[0] as NotificationAdmissionPointer | undefined;
}

export async function lockNotificationAuthority(
  tx: DbOrTx,
  args: NotificationAdmissionArgs,
  ownerId: string,
): Promise<NotificationAdmissionAuthority | null> {
  const owner = (
    await tx.execute(sql`SELECT is_active,invited_at FROM users
    WHERE id=${ownerId} FOR NO KEY UPDATE`)
  ).rows[0] as { is_active: boolean; invited_at: unknown } | undefined;
  args.signal.throwIfAborted();
  if (owner === undefined) return null;
  const account = (
    await tx.execute(sql`SELECT status,paused,
    (capabilities->'send'='true'::jsonb) IS TRUE AS send_capable
    FROM email_accounts WHERE id=${args.accountId} AND user_id=${ownerId}
    FOR NO KEY UPDATE`)
  ).rows[0] as { status: string; paused: boolean; send_capable: boolean } | undefined;
  args.signal.throwIfAborted();
  if (account === undefined) return null;
  return {
    ownerId,
    active: owner.is_active,
    invited: owner.invited_at !== null,
    connected: account.status === "connected" && !account.paused,
    sendCapable: account.send_capable,
  };
}

export async function lockNotificationAttempt(
  tx: DbOrTx,
  args: NotificationAdmissionArgs,
): Promise<NotificationAdmissionAttempt | undefined> {
  const rows = await tx.execute(sql`SELECT s.id,s.idempotency_key,s.payload,
    (${provenUnsubmitted}) IS TRUE AS unsubmitted,
    s.notification_suppressed_at IS NOT NULL AS suppressed
    FROM email_send_attempts s WHERE s.id=${args.attemptId}
      AND s.account_id=${args.accountId} FOR UPDATE`);
  args.signal.throwIfAborted();
  return rows.rows[0] as NotificationAdmissionAttempt | undefined;
}

export async function suppressNotificationAttempt(
  tx: DbOrTx,
  args: NotificationAdmissionArgs,
  reason: NotificationSuppressionReason,
): Promise<boolean> {
  const changed = await tx.execute(sql`UPDATE email_send_attempts s
    SET notification_suppressed_at=clock_timestamp(),notification_suppression_reason=${reason}
    WHERE s.id=${args.attemptId} AND s.account_id=${args.accountId}
      AND s.notification_suppressed_at IS NULL AND (${provenUnsubmitted}) IS TRUE
    RETURNING s.id`);
  args.signal.throwIfAborted();
  return changed.rows.length === 1;
}

export function notificationAdmissionContended(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null || visited.has(current)) return false;
    visited.add(current);
    if ("code" in current && current.code === "55P03") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
