import { and, eq, sql } from "drizzle-orm";
import { mailFolders, mailMessageLocators } from "@/db/schema/mailRemote";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { invalidateImapEpoch } from "./imapSyncReset";
import type { ImapMovedCopy } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

export async function persistImapMovedCopy(
  tx: DbOrTx,
  runtime: ImapConnectionRuntime,
  copy: ImapMovedCopy,
  signal: AbortSignal,
): Promise<boolean> {
  await tx
    .insert(mailFolders)
    .values({
      accountId: runtime.accountId,
      path: copy.path,
      uidValidity: copy.uidValidity,
      readOnly: false,
    })
    .onConflictDoNothing({ target: [mailFolders.accountId, mailFolders.path] });
  const [folder] = await tx
    .select({ id: mailFolders.id, uidValidity: mailFolders.uidValidity })
    .from(mailFolders)
    .where(and(eq(mailFolders.accountId, runtime.accountId), eq(mailFolders.path, copy.path)))
    .for("no key update");
  signal.throwIfAborted();
  if (folder === undefined) return false;
  if (folder.uidValidity !== copy.uidValidity) {
    await invalidateImapEpoch(tx, runtime.accountId, runtime.ownerId, folder.id, signal);
    await tx
      .update(mailFolders)
      .set({
        uidValidity: copy.uidValidity,
        lastUid: 0,
        reconcileAfterUid: 0,
        readOnly: false,
        updatedAt: new Date(),
      })
      .where(eq(mailFolders.id, folder.id));
  }
  const inserted = await tx
    .insert(mailMessageLocators)
    .values({
      accountId: runtime.accountId,
      folderId: folder.id,
      uidValidity: copy.uidValidity,
      uid: copy.uid,
      messageId: copy.locator.messageId,
      flags: copy.flags,
      active: copy.active,
    })
    .onConflictDoUpdate({
      target: [
        mailMessageLocators.folderId,
        mailMessageLocators.uidValidity,
        mailMessageLocators.uid,
      ],
      set: {
        messageId: copy.locator.messageId,
        flags: copy.flags,
        active: copy.active,
        lastSeenAt: sql`clock_timestamp()`,
      },
      setWhere: sql`${mailMessageLocators.messageId} IS NULL OR ${mailMessageLocators.messageId}=${copy.locator.messageId}`,
    })
    .returning({ id: mailMessageLocators.id });
  signal.throwIfAborted();
  if (inserted.length !== 1) return false;
  await tx.execute(sql`UPDATE email_message_attachments SET provider_locator=provider_locator ||
    jsonb_build_object('folderPath',${copy.path}::text,'uidValidity',${copy.uidValidity}::text,'uid',${copy.uid}::bigint)
    WHERE account_id=${runtime.accountId} AND message_id=${copy.locator.messageId} AND provider_locator->>'kind'='imap'
      AND provider_locator->>'folderPath'=${copy.locator.path} AND provider_locator->>'uidValidity'=${copy.locator.uidValidity}
      AND provider_locator->>'uid'=${String(copy.locator.uid)}`);
  signal.throwIfAborted();
  return true;
}
