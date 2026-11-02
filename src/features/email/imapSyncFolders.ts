import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { mailFolders } from "@/db/schema/mailRemote";
import { guardImapConnection } from "./imapSyncGuard";
import { invalidateImapEpoch } from "./imapSyncReset";
import type { ImapFolderCheckpoint } from "./imapSyncTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

const DAY_MS = 86_400_000;

export async function prepareImapFolder(
  db: Db,
  runtime: ImapConnectionRuntime,
  path: string,
  metadata: { uidValidity: string; readOnly: boolean; isSentFolder: boolean },
  now: Date,
  signal: AbortSignal,
): Promise<ImapFolderCheckpoint | null> {
  return db.transaction(async (tx) => {
    if (!(await guardImapConnection(tx, runtime, signal))) return null;
    await tx
      .insert(mailFolders)
      .values({ accountId: runtime.accountId, path })
      .onConflictDoNothing({ target: [mailFolders.accountId, mailFolders.path] });
    const [folder] = await tx
      .select()
      .from(mailFolders)
      .where(and(eq(mailFolders.accountId, runtime.accountId), eq(mailFolders.path, path)))
      .for("no key update");
    signal.throwIfAborted();
    if (folder === undefined) return null;
    const reset =
      folder.uidValidity !== metadata.uidValidity || folder.historyDays !== runtime.historyDays;
    if (folder.uidValidity !== metadata.uidValidity)
      await invalidateImapEpoch(tx, runtime.accountId, runtime.ownerId, folder.id, signal);
    const historySince =
      folder.historySince !== null && folder.historyDays === runtime.historyDays
        ? folder.historySince
        : new Date(now.getTime() - runtime.historyDays * DAY_MS);
    const lastUid = reset ? 0 : folder.lastUid;
    const [updated] = await tx
      .update(mailFolders)
      .set({
        uidValidity: metadata.uidValidity,
        readOnly: metadata.readOnly,
        historyDays: runtime.historyDays,
        historySince,
        lastUid,
        reconcileAfterUid: reset ? 0 : folder.reconcileAfterUid,
        updatedAt: sql`clock_timestamp()`,
        lastErrorKind: null,
      })
      .where(eq(mailFolders.id, folder.id))
      .returning({ version: sql<string>`${mailFolders.updatedAt}::text` });
    signal.throwIfAborted();
    if (updated === undefined) return null;
    return {
      id: folder.id,
      path,
      uidValidity: metadata.uidValidity,
      lastUid,
      historySince,
      reconcileAfterUid: reset ? 0 : folder.reconcileAfterUid,
      notificationAfter: folder.createdAt,
      isSentFolder: metadata.isSentFolder,
      version: updated.version,
    };
  });
}

export async function imapFolderOrder(
  db: Db,
  runtime: ImapConnectionRuntime,
  signal: AbortSignal,
): Promise<string[]> {
  signal.throwIfAborted();
  const existing = await db
    .select({ path: mailFolders.path, lastSyncAt: mailFolders.lastSyncAt })
    .from(mailFolders)
    .where(eq(mailFolders.accountId, runtime.accountId));
  signal.throwIfAborted();
  const last = new Map(existing.map((folder) => [folder.path, folder.lastSyncAt?.getTime() ?? -1]));
  return [...runtime.folderPaths].sort((a, b) => (last.get(a) ?? -1) - (last.get(b) ?? -1));
}

export async function recordImapFolderFailure(
  db: Db,
  runtime: ImapConnectionRuntime,
  path: string,
  kind: string,
  signal: AbortSignal,
): Promise<void> {
  await db.transaction(async (tx) => {
    if (!(await guardImapConnection(tx, runtime, signal))) return;
    await tx.execute(sql`UPDATE mail_folders SET last_error_kind=${kind},updated_at=now()
      WHERE account_id=${runtime.accountId} AND path=${path}`);
    signal.throwIfAborted();
  });
}
