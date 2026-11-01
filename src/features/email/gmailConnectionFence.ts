import { sql } from "drizzle-orm";
import { AppError } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { err, ok, type Result } from "@/types/result";

export interface GmailConnectionSnapshot {
  user_id: string;
  connection_generation: number;
  last_history_id: string | null;
  last_sync_at: Date | null;
}
export const gmailConnectionChanged = (): AppError =>
  new AppError("E_AUTH_001", "gmail connection authority changed", {
    reason: "connection_changed",
  });

export async function readGmailConnection(
  db: DbOrTx,
  accountId: string,
  signal: AbortSignal,
  expectedGeneration?: number,
): Promise<GmailConnectionSnapshot | null> {
  signal.throwIfAborted();
  const row = (
    await db.execute(sql`
    SELECT a.user_id,a.connection_generation,a.last_history_id,a.last_sync_at FROM email_accounts a
    JOIN users owner ON owner.id=a.user_id
    WHERE a.id=${accountId} AND a.provider='gmail' AND a.status<>'disconnected' AND NOT a.paused
      AND owner.is_active AND owner.invited_at IS NULL
  `)
  ).rows[0] as GmailConnectionSnapshot | undefined;
  signal.throwIfAborted();
  return row === undefined ||
    (expectedGeneration !== undefined && row.connection_generation !== expectedGeneration)
    ? null
    : row;
}

// Short persistence fence only. Google IO must finish before entering here. The
// owner->account lock order matches disconnect, reconnect and offboarding.
export async function withGmailConnection<T>(
  db: Db,
  accountId: string,
  generation: number,
  signal: AbortSignal,
  work: (tx: DbOrTx) => Promise<T>,
): Promise<Result<T, AppError>> {
  signal.throwIfAborted();
  return db.transaction(
    async (tx) => {
      const pointer = (
        await tx.execute(sql`SELECT user_id FROM email_accounts WHERE id=${accountId}`)
      ).rows[0] as { user_id: string } | undefined;
      if (pointer === undefined) return err(gmailConnectionChanged());
      const owner = (
        await tx.execute(
          sql`SELECT id FROM users WHERE id=${pointer.user_id} AND is_active AND invited_at IS NULL FOR NO KEY UPDATE`,
        )
      ).rows[0];
      if (owner === undefined) return err(gmailConnectionChanged());
      const account = (
        await tx.execute(sql`
      SELECT id FROM email_accounts WHERE id=${accountId} AND user_id=${pointer.user_id}
        AND provider='gmail' AND status<>'disconnected' AND NOT paused AND connection_generation=${generation}
      FOR NO KEY UPDATE
    `)
      ).rows[0];
      signal.throwIfAborted();
      if (account === undefined) return err(gmailConnectionChanged());
      const value = await work(tx);
      signal.throwIfAborted();
      return ok(value);
    },
    { isolationLevel: "read committed" },
  );
}
