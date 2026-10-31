import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { lockMailRemoteWrites } from "./mailRemoteWriteLock";

export async function guardImapConnection(
  tx: DbOrTx,
  runtime: Pick<ImapConnectionRuntime, "accountId" | "ownerId" | "generation">,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  await lockMailRemoteWrites(tx, runtime.accountId, signal);
  // Match offboarding's owner -> account lock order. NO KEY UPDATE remains FK-compatible.
  const owner = (
    await tx.execute(
      sql`SELECT is_active,invited_at FROM users WHERE id=${runtime.ownerId} FOR NO KEY UPDATE`,
    )
  ).rows[0] as { is_active: boolean; invited_at: Date | null } | undefined;
  signal.throwIfAborted();
  if (owner?.is_active !== true || owner.invited_at !== null) return false;
  const account = (
    await tx.execute(sql`
    SELECT id FROM email_accounts WHERE id=${runtime.accountId} AND user_id=${runtime.ownerId}
      AND provider='imap_smtp' AND status='connected' AND paused=false
      AND connection_generation=${runtime.generation} FOR NO KEY UPDATE
  `)
  ).rows[0];
  signal.throwIfAborted();
  return account !== undefined;
}
