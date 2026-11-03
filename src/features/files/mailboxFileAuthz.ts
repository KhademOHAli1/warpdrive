import { sql } from "drizzle-orm";
import type { AuthUser } from "@/features/permissions/types";
import type { DbOrTx } from "@/server/realtime/channelVersions";

// Mailbox-scoped composer files belong to the current mailbox owner, like local drafts.
// A shared message or administrator role never grants access to this private parent.
// Pausing/disconnecting remote transport does not remove local draft authoring access.
export async function canUseMailboxFiles(
  db: DbOrTx,
  actor: AuthUser,
  accountId: string,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  if (!actor.isActive) return false;
  const row = (
    await db.execute(sql`SELECT a.id FROM email_accounts a
      JOIN users u ON u.id=a.user_id
      WHERE a.id=${accountId} AND a.user_id=${actor.id}
        AND u.is_active=true AND u.invited_at IS NULL`)
  ).rows[0];
  signal.throwIfAborted();
  return row !== undefined;
}
