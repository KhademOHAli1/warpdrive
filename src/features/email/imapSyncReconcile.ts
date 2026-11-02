import { and, asc, eq, getTableColumns, gt, sql } from "drizzle-orm";
import { wsChannel } from "@/constants/wsChannels";
import type { Db } from "@/db/client";
import { mailFolders, mailMessageLocators } from "@/db/schema/mailRemote";
import { publishEvent } from "@/server/notify";
import { err, ok, type Result } from "@/types/result";
import { guardImapConnection } from "./imapSyncGuard";
import { refreshImapThreadReadState } from "./imapSyncReadState";
import { reconciledImapThread } from "./imapSyncReconcileThread";
import type { ImapFolderCheckpoint } from "./imapSyncTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapFailure } from "./providers/imapTypes";

const RECONCILE_BATCH = 100;

function sameFlags(a: string[], b: string[]): boolean {
  const normalized = (flags: string[]) => flags.map((flag) => flag.toLowerCase()).sort();
  return JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
}

export async function reconcileImapFolder(
  db: Db,
  runtime: ImapConnectionRuntime,
  folder: ImapFolderCheckpoint,
  signal: AbortSignal,
): Promise<Result<{ stale: boolean; changed: number }, ImapFailure>> {
  const rows = await db
    .select({
      ...getTableColumns(mailMessageLocators),
      seenVersion: sql<string>`${mailMessageLocators.lastSeenAt}::text`,
    })
    .from(mailMessageLocators)
    .where(
      and(
        eq(mailMessageLocators.accountId, runtime.accountId),
        eq(mailMessageLocators.folderId, folder.id),
        eq(mailMessageLocators.uidValidity, folder.uidValidity),
        eq(mailMessageLocators.active, true),
        gt(mailMessageLocators.uid, folder.reconcileAfterUid),
      ),
    )
    .orderBy(asc(mailMessageLocators.uid))
    .limit(RECONCILE_BATCH);
  signal.throwIfAborted();
  if (rows.length === 0) {
    if (folder.reconcileAfterUid > 0)
      await db.transaction(async (tx) => {
        if (await guardImapConnection(tx, runtime, signal))
          await tx
            .update(mailFolders)
            .set({ reconcileAfterUid: 0 })
            .where(eq(mailFolders.id, folder.id));
      });
    return ok({ stale: false, changed: 0 });
  }
  const inspected = await runtime.imap.inspectMessages({
    path: folder.path,
    uidValidity: folder.uidValidity,
    uids: rows.map((row) => row.uid),
    signal,
  });
  if (!inspected.ok) return err(inspected.error);
  return db.transaction(async (tx) => {
    if (!(await guardImapConnection(tx, runtime, signal))) return ok({ stale: true, changed: 0 });
    const [current] = await tx
      .select({ uidValidity: mailFolders.uidValidity })
      .from(mailFolders)
      .where(eq(mailFolders.id, folder.id))
      .for("no key update");
    signal.throwIfAborted();
    if (current?.uidValidity !== folder.uidValidity) return ok({ stale: true, changed: 0 });
    const flagsByUid = new Map(
      inspected.value.messages.map((message) => [message.uid, message.flags]),
    );
    const missing = new Set(inspected.value.missing);
    const threadIds: string[] = [];
    let changed = 0;
    for (const row of rows) {
      const flags = flagsByUid.get(row.uid);
      if (!missing.has(row.uid) && (flags === undefined || sameFlags(flags, row.flags))) continue;
      const updated = await tx
        .update(mailMessageLocators)
        .set({
          flags: flags ?? row.flags,
          active: !missing.has(row.uid),
          lastSeenAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(mailMessageLocators.id, row.id),
            eq(mailMessageLocators.active, row.active),
            eq(mailMessageLocators.flags, row.flags),
            sql`${mailMessageLocators.lastSeenAt}=${row.seenVersion}::timestamptz`,
          ),
        )
        .returning({ id: mailMessageLocators.id });
      signal.throwIfAborted();
      // A newer confirmed write or poll wins over this older network snapshot.
      if (updated.length === 0) continue;
      const threadId = await reconciledImapThread(tx, {
        accountId: runtime.accountId,
        messageId: row.messageId,
        missing: missing.has(row.uid),
        signal,
      });
      if (threadId !== null) threadIds.push(threadId);
      signal.throwIfAborted();
      changed += 1;
    }
    await refreshImapThreadReadState(tx, runtime.accountId, runtime.ownerId, threadIds, signal);
    if (changed > 0)
      await publishEvent(
        tx,
        {
          v: 1,
          channel: wsChannel.user(runtime.ownerId),
          ts: new Date().toISOString(),
          actorId: null,
          type: "email_mailbox_changed",
          data: { accountId: runtime.accountId },
        },
        signal,
      );
    await tx
      .update(mailFolders)
      .set({ reconcileAfterUid: rows.length < RECONCILE_BATCH ? 0 : (rows.at(-1)?.uid ?? 0) })
      .where(eq(mailFolders.id, folder.id));
    signal.throwIfAborted();
    return ok({ stale: false, changed });
  });
}
