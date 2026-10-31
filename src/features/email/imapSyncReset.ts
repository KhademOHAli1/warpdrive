import { eq, sql } from "drizzle-orm";
import { wsChannel } from "@/constants/wsChannels";
import { mailMessageLocators } from "@/db/schema/mailRemote";
import { publishEvent } from "@/server/notify";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { repairImapEpochAttachmentLocators } from "./imapApplyAttachmentFallback";

export async function invalidateImapEpoch(
  tx: DbOrTx,
  accountId: string,
  ownerId: string,
  folderId: string,
  signal: AbortSignal,
): Promise<void> {
  await tx
    .update(mailMessageLocators)
    .set({ active: false })
    .where(eq(mailMessageLocators.folderId, folderId));
  signal.throwIfAborted();
  await repairImapEpochAttachmentLocators(tx, accountId, folderId, signal);
  // Invalid UIDs are not a live copy. Preserve CRM rows and restore visibility when re-observed.
  const hidden = await tx.execute(sql`
    UPDATE email_threads t SET trashed_at=now(),updated_at=now()
    WHERE t.account_id=${accountId} AND t.trashed_at IS NULL
      AND EXISTS(SELECT 1 FROM email_messages m JOIN mail_message_locators l
        ON l.message_id=m.id AND l.account_id=m.account_id
        WHERE m.thread_id=t.id AND m.account_id=${accountId} AND l.folder_id=${folderId})
      AND NOT EXISTS(SELECT 1 FROM email_messages m JOIN mail_message_locators l
        ON l.message_id=m.id AND l.account_id=m.account_id
        WHERE m.thread_id=t.id AND m.account_id=${accountId} AND l.active=true)
  `);
  signal.throwIfAborted();
  if ((hidden.rowCount ?? 0) > 0)
    await publishEvent(
      tx,
      {
        v: 1,
        channel: wsChannel.user(ownerId),
        ts: new Date().toISOString(),
        actorId: null,
        type: "email_mailbox_changed",
        data: { accountId },
      },
      signal,
    );
}
