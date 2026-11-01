import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";

// An untrusted header can restrict local treatment. It cannot choose an attempt,
// confirm delivery, merge a copy, mark a notification sent or authorize a retry.
export async function hasPrivateNotificationHint(
  tx: DbOrTx,
  accountId: string,
  messageIdHeader: string | null,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (messageIdHeader === null || messageIdHeader.length === 0) return false;
  const result = await tx.execute(sql`SELECT 1 FROM email_send_attempts s
    JOIN email_accounts a ON a.id=s.account_id
    WHERE s.account_id=${accountId} AND s.message_id_header=${messageIdHeader}
      AND s.thread_id IS NULL AND s.payload->'systemPurpose'=jsonb_build_object(
        'version',1,'kind','notification','notificationId',s.idempotency_key::text,
        'recipientUserId',a.user_id::text) LIMIT 1`);
  signal.throwIfAborted();
  return result.rows.length !== 0;
}
