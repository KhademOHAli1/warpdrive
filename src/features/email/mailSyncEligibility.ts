import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

export async function isMailboxSyncEnabled(
  db: Db,
  accountId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const rows = await db.execute(sql`SELECT a.id FROM email_accounts a JOIN users u ON u.id=a.user_id
    WHERE a.id=${accountId} AND u.is_active AND u.invited_at IS NULL AND NOT a.paused
      AND a.status<>'disconnected' AND a.provider IN ('gmail','imap_smtp')`);
  signal.throwIfAborted();
  return rows.rows.length === 1;
}
