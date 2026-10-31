import { and, eq, sql } from "drizzle-orm";
import { wsChannel } from "@/constants/wsChannels";
import { mailFolders, mailMessageLocators } from "@/db/schema/mailRemote";
import { publishEvent } from "@/server/notify";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { refreshImapThreadReadState } from "./imapSyncReadState";
import type { ImapNetworkOutcome } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

export async function persistImapReadState(
  tx: DbOrTx,
  runtime: ImapConnectionRuntime,
  threadId: string,
  outcome: ImapNetworkOutcome,
  read: boolean,
  signal: AbortSignal,
): Promise<void> {
  for (const row of outcome.confirmed) {
    await tx
      .update(mailMessageLocators)
      .set({ flags: row.flags, active: row.active, lastSeenAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(mailMessageLocators.id, row.locator.id),
          eq(mailMessageLocators.accountId, runtime.accountId),
        ),
      );
    signal.throwIfAborted();
  }
  if (outcome.confirmed.length === 0) return;
  await tx
    .update(mailFolders)
    .set({ updatedAt: sql`clock_timestamp()` })
    .where(eq(mailFolders.accountId, runtime.accountId));
  await refreshImapThreadReadState(tx, runtime.accountId, runtime.ownerId, [threadId], signal);
  if (outcome.failure === null) {
    if (read)
      await tx.execute(sql`INSERT INTO email_thread_reads (thread_id,user_id,read_at)
      SELECT id,${runtime.ownerId},GREATEST(now(),last_message_at) FROM email_threads WHERE id=${threadId} AND account_id=${runtime.accountId}
      ON CONFLICT (thread_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at`);
    else
      await tx.execute(
        sql`DELETE FROM email_thread_reads WHERE thread_id=${threadId} AND user_id=${runtime.ownerId}`,
      );
  }
  signal.throwIfAborted();
  await publishEvent(
    tx,
    {
      v: 1,
      channel: wsChannel.user(runtime.ownerId),
      ts: new Date().toISOString(),
      actorId: runtime.ownerId,
      type: "email_mailbox_changed",
      data: { accountId: runtime.accountId },
    },
    signal,
  );
}
