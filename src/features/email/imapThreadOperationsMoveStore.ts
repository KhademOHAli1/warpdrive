import { and, eq, sql } from "drizzle-orm";
import { wsChannel } from "@/constants/wsChannels";
import { mailFolders, mailMessageLocators } from "@/db/schema/mailRemote";
import { publishEvent } from "@/server/notify";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { refreshImapThreadReadState } from "./imapSyncReadState";
import { persistImapMovedCopy } from "./imapThreadOperationsMoveCopy";
import type { ImapNetworkOutcome } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

export async function persistImapMoveState(
  tx: DbOrTx,
  runtime: ImapConnectionRuntime,
  threadId: string,
  outcome: ImapNetworkOutcome,
  signal: AbortSignal,
): Promise<boolean> {
  for (const row of outcome.confirmed) {
    await tx
      .update(mailMessageLocators)
      .set({ active: false, flags: row.flags, lastSeenAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(mailMessageLocators.id, row.locator.id),
          eq(mailMessageLocators.accountId, runtime.accountId),
        ),
      );
    signal.throwIfAborted();
  }
  let consistent = true;
  for (const copy of outcome.movedCopies ?? [])
    consistent = (await persistImapMovedCopy(tx, runtime, copy, signal)) && consistent;
  if (outcome.confirmed.length === 0) return consistent;
  await tx
    .update(mailFolders)
    .set({ updatedAt: sql`clock_timestamp()` })
    .where(eq(mailFolders.accountId, runtime.accountId));
  await refreshImapThreadReadState(tx, runtime.accountId, runtime.ownerId, [threadId], signal);
  if (outcome.trash === true && outcome.failure === null && consistent)
    await tx.execute(sql`UPDATE email_threads SET remote_trashed_at=COALESCE(remote_trashed_at,now()),trashed_at=now(),updated_at=now()
      WHERE id=${threadId} AND account_id=${runtime.accountId}`);
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
  return consistent;
}
