import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { privateIntakeBlocksThread } from "./privateIntakeRestrictions";

// Recheck already-admitted/legacy queued mail before claims, preparation or client
// resolution. A receipt/stamped attempt keeps its existing no-resend repair path.
export async function privateIntakeBlocksQueuedSend(
  db: DbOrTx,
  args: { accountId: string; idempotencyKey: string; signal: AbortSignal },
): Promise<boolean> {
  args.signal.throwIfAborted();
  const result = await db.execute(sql`SELECT 1 FROM email_send_attempts s
    WHERE s.account_id=${args.accountId} AND s.idempotency_key=${args.idempotencyKey}
      AND s.send_started_at IS NULL
      AND ${privateIntakeBlocksThread(sql`s.account_id`, sql`s.thread_id`)} LIMIT 1`);
  args.signal.throwIfAborted();
  return result.rows.length !== 0;
}
