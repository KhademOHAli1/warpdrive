import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { wsChannel } from "@/constants/wsChannels";
import type { Db } from "@/db/client";
import { emailAccounts, emailMessages } from "@/db/schema";
import { mailFolders, mailMessageLocators } from "@/db/schema/mailRemote";
import { publishEvent } from "@/server/notify";
import type { DbOrTx } from "@/server/realtime/channelVersions";
import { applyImapMessage } from "./imapApplyMessage";
import { imapPageHasPendingSentCopy } from "./imapApplyPending";
import { guardImapConnection } from "./imapSyncGuard";
import { refreshImapThreadReadState } from "./imapSyncReadState";
import type { ImapFolderCheckpoint, PreparedImapPage } from "./imapSyncTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import { hydrateOwner } from "./syncCursor";

async function locator(
  tx: DbOrTx,
  accountId: string,
  folder: ImapFolderCheckpoint,
  uid: number,
  messageId: string | null,
  flags: string[],
  skippedReason: "message_too_large" | "message_missing" | "invalid_message" | null,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  await tx
    .insert(mailMessageLocators)
    .values({
      accountId,
      folderId: folder.id,
      uidValidity: folder.uidValidity,
      uid,
      messageId,
      flags,
      skippedReason,
      active: true,
    })
    .onConflictDoUpdate({
      target: [
        mailMessageLocators.folderId,
        mailMessageLocators.uidValidity,
        mailMessageLocators.uid,
      ],
      set: { messageId, flags, skippedReason, active: true, lastSeenAt: sql`clock_timestamp()` },
    });
  signal.throwIfAborted();
}

export async function applyImapPage(
  db: Db,
  runtime: ImapConnectionRuntime,
  folder: ImapFolderCheckpoint,
  prepared: PreparedImapPage,
  now: Date,
  signal: AbortSignal,
): Promise<{ applied: number; stale: boolean; deferred?: boolean; nextVersion?: string }> {
  return db.transaction(async (tx) => {
    if (!(await guardImapConnection(tx, runtime, signal))) return { applied: 0, stale: true };
    const [current] = await tx
      .select({
        ...getTableColumns(mailFolders),
        version: sql<string>`${mailFolders.updatedAt}::text`,
      })
      .from(mailFolders)
      .where(and(eq(mailFolders.id, folder.id), eq(mailFolders.accountId, runtime.accountId)))
      .for("no key update");
    signal.throwIfAborted();
    if (
      current === undefined ||
      current.uidValidity !== prepared.page.uidValidity ||
      current.lastUid !== folder.lastUid ||
      current.version !== folder.version
    )
      return { applied: 0, stale: true };
    // Keep the complete page and cursor untouched until the qualified SMTP artifact exists.
    if (await imapPageHasPendingSentCopy(tx, runtime.accountId, folder, prepared, signal))
      return { applied: 0, stale: false, deferred: true };
    const owner = await hydrateOwner(tx, runtime.ownerId, signal);
    if (!owner.ok) throw owner.error;
    let applied = 0;
    const threadIds: string[] = [];
    for (const message of prepared.messages) {
      const result = await applyImapMessage(tx, runtime, folder, owner.value, message, now, signal);
      await locator(
        tx,
        runtime.accountId,
        folder,
        message.uid,
        result.messageId,
        message.flags,
        null,
        signal,
      );
      const [row] = await tx
        .select({ threadId: emailMessages.threadId })
        .from(emailMessages)
        .where(eq(emailMessages.id, result.messageId));
      if (row !== undefined) threadIds.push(row.threadId);
      if (result.inserted) applied += 1;
    }
    for (const skipped of prepared.skipped)
      await locator(tx, runtime.accountId, folder, skipped.uid, null, [], skipped.reason, signal);
    await refreshImapThreadReadState(tx, runtime.accountId, runtime.ownerId, threadIds, signal);
    if (prepared.messages.length > 0 || prepared.skipped.length > 0)
      await publishEvent(
        tx,
        {
          v: 1,
          channel: wsChannel.user(runtime.ownerId),
          ts: now.toISOString(),
          actorId: null,
          type: "email_mailbox_changed",
          data: { accountId: runtime.accountId },
        },
        signal,
      );
    const [updated] = await tx
      .update(mailFolders)
      .set({
        lastUid: prepared.page.lastUid,
        readOnly: prepared.page.readOnly,
        lastSyncAt: now,
        lastErrorKind: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(mailFolders.id, folder.id))
      .returning({ version: sql<string>`${mailFolders.updatedAt}::text` });
    await tx
      .update(emailAccounts)
      .set({ lastSyncAt: now, lastErrorId: null, updatedAt: now })
      .where(eq(emailAccounts.id, runtime.accountId));
    signal.throwIfAborted();
    if (updated === undefined)
      throw new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "IMAP folder update returned no row");
    return { applied, stale: false, nextVersion: updated.version };
  });
}
