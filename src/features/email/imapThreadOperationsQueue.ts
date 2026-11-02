import { queueMailboxSync } from "./queueMailboxSync";

export async function reconcileImapOperation(
  accountId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    await queueMailboxSync(accountId, signal);
  } catch {
    signal.throwIfAborted();
  }
}

import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

export async function reconcileThreadImapOperation(
  db: Db,
  actorId: string,
  threadId: string,
  signal: AbortSignal,
): Promise<void> {
  try {
    const [account] = (
      await db.execute(sql`SELECT a.id FROM email_accounts a JOIN email_threads t ON t.account_id=a.id
      WHERE t.id=${threadId} AND a.user_id=${actorId} AND a.provider='imap_smtp'`)
    ).rows;
    signal.throwIfAborted();
    if (typeof account?.id === "string") await reconcileImapOperation(account.id, signal);
  } catch {
    signal.throwIfAborted();
  }
}
