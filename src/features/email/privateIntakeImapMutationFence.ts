import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { type ImapConnectionRuntime, isMailConnectionCurrent } from "./mailConnectionRuntime";
import { privateIntakeBlocksThread } from "./privateIntakeRestrictions";

export type ImapMutationFence = (signal: AbortSignal) => Promise<boolean>;

// Use the existing READ COMMITTED I/O transaction: never borrow another pool
// connection or acquire authority row locks across provider I/O. Classification
// precedes the established current-owner/account check, keeping that check last.
export async function privateIntakeImapMutationCurrent(
  tx: DbOrTx,
  runtime: ImapConnectionRuntime,
  threadId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  const result = await tx.execute(sql`SELECT t.id FROM email_threads t
        WHERE t.account_id=${runtime.accountId} AND t.id=${threadId}
          AND NOT ${privateIntakeBlocksThread(sql`t.account_id`, sql`t.id`)}`);
  signal.throwIfAborted();
  if (result.rows.length !== 1) return false;
  return isMailConnectionCurrent(tx, runtime, signal);
}
