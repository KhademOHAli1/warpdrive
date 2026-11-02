import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { parseNotificationSendPurpose } from "@/features/email/mailSendPurpose";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";
import type { PreparedNotificationEmail } from "./notificationEmailTypes";

interface BindingRow {
  id: string;
  account_id: string;
  owner_id: string;
  idempotency_key: string;
  payload: unknown;
  notification_suppressed_at: unknown;
}

export async function notificationBindingRows(
  db: DbOrTx,
  notificationId: string,
  recipientId: string | null,
  signal: AbortSignal,
  lock: boolean,
): Promise<BindingRow[]> {
  signal.throwIfAborted();
  const rows = await db.execute(sql`SELECT s.id,s.account_id,a.user_id AS owner_id,
    s.idempotency_key,s.payload,s.notification_suppressed_at
    FROM email_send_attempts s JOIN email_accounts a ON a.id=s.account_id
    WHERE s.payload->'systemPurpose'->>'notificationId'=${notificationId}
      OR (${recipientId}::uuid IS NOT NULL AND a.user_id=${recipientId}::uuid
        AND s.idempotency_key=${notificationId}::uuid)
    ORDER BY s.account_id,s.id LIMIT 2 ${lock ? sql`FOR UPDATE OF s` : sql``}`);
  signal.throwIfAborted();
  return rows.rows as unknown as BindingRow[];
}

export function existingNotificationBinding(
  rows: BindingRow[],
  notificationId: string,
  recipientId: string | null,
): Result<PreparedNotificationEmail | null, AppError> {
  if (rows.length === 0) return ok(null);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) return bindingConflict();
  const rawPurpose =
    typeof row.payload === "object" && row.payload !== null && "systemPurpose" in row.payload
      ? row.payload.systemPurpose
      : undefined;
  const purpose = parseNotificationSendPurpose(rawPurpose);
  if (
    purpose === null ||
    purpose.notificationId !== notificationId ||
    purpose.recipientUserId !== row.owner_id ||
    (recipientId !== null && purpose.recipientUserId !== recipientId) ||
    row.idempotency_key !== notificationId
  )
    return bindingConflict();
  return ok({
    status: "prepared",
    attemptId: row.id,
    accountId: row.account_id,
    idempotencyKey: row.idempotency_key,
    recipientUserId: purpose.recipientUserId,
  });
}

export function notificationBindingSuppressed(rows: BindingRow[]): boolean {
  return rows[0]?.notification_suppressed_at != null;
}

function bindingConflict(): Result<never, AppError> {
  return err(
    new AppError(ERROR_IDS.NOTIF_SEND_BINDING_CONFLICT, "Notification intent is bound differently"),
  );
}

export async function notificationMailbox(
  db: DbOrTx,
  recipientId: string,
  signal: AbortSignal,
): Promise<{ id: string; email_address: string } | undefined> {
  const rows = await db.execute(sql`SELECT id,email_address FROM email_accounts
    WHERE user_id=${recipientId} AND provider IN ('gmail','imap_smtp')
      AND status='connected' AND NOT paused AND capabilities->'send'='true'::jsonb
    ORDER BY is_default DESC,created_at,id LIMIT 1 FOR NO KEY UPDATE`);
  signal.throwIfAborted();
  return rows.rows[0] as { id: string; email_address: string } | undefined;
}
