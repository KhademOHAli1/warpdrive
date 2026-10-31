import { setTimeout as delay } from "node:timers/promises";
import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { DbOrTx } from "@/server/realtime/channelVersions";

const LOCK_POLL_MS = 50;
const LOCK_WAIT_MS = 30_000;

// Acquire before owner/account row locks. Offboarding deliberately never waits on this I/O lock.
export async function lockMailRemoteWrites(
  tx: DbOrTx,
  accountId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  if (!("rollback" in tx))
    throw new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "mail remote write lock requires a transaction");
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const result = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(
      hashtextextended(${`mail-remote-write:${accountId}`},0)) AS acquired`);
    signal.throwIfAborted();
    if ((result.rows[0] as { acquired: boolean } | undefined)?.acquired === true) return;
    if (Date.now() >= deadline)
      throw new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "mail remote write lock contention");
    try {
      await delay(LOCK_POLL_MS, undefined, { signal });
    } catch (error) {
      signal.throwIfAborted();
      throw error;
    }
  }
}
