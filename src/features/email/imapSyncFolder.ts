import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { applyImapPage } from "./imapApplyPage";
import { prepareImapFolder, recordImapFolderFailure } from "./imapSyncFolders";
import { prepareImapPage } from "./imapSyncPrepare";
import { reconcileImapFolder } from "./imapSyncReconcile";
import type { ImapFolderCheckpoint, ImapSyncOutcome } from "./imapSyncTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";

interface FolderOutcome extends ImapSyncOutcome {
  usedPages: number;
}

async function readPages(
  db: Db,
  runtime: ImapConnectionRuntime,
  initial: ImapFolderCheckpoint,
  args: { now: Date; budget: number; signal: AbortSignal },
): Promise<Result<FolderOutcome, AppError>> {
  const outcome: FolderOutcome = {
    applied: 0,
    skipped: 0,
    more: false,
    stale: false,
    usedPages: 0,
  };
  let folder = initial;
  for (let index = 0; index < args.budget; index += 1) {
    const read = await runtime.imap.readFolder({
      path: folder.path,
      afterUid: folder.lastUid,
      since: folder.historySince,
      signal: args.signal,
    });
    if (!read.ok) {
      await recordImapFolderFailure(db, runtime, folder.path, read.error.kind, args.signal);
      return err(
        new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "IMAP folder read failed", {
          reason: read.error.kind,
        }),
      );
    }
    const prepared = await prepareImapPage(runtime.accountId, read.value, args.signal);
    const applied = await applyImapPage(db, runtime, folder, prepared, args.now, args.signal);
    if (applied.stale) return ok({ ...outcome, stale: true });
    if (applied.deferred === true) return ok({ ...outcome, more: true, deferred: true });
    outcome.applied += applied.applied;
    outcome.skipped += prepared.skipped.length;
    outcome.usedPages += 1;
    outcome.more = read.value.hasMore;
    if (!outcome.more) break;
    folder = {
      ...folder,
      lastUid: read.value.lastUid,
      version: applied.nextVersion ?? folder.version,
    };
  }
  return ok(outcome);
}

export async function syncImapFolder(
  db: Db,
  runtime: ImapConnectionRuntime,
  path: string,
  args: { now: Date; budget: number; signal: AbortSignal; isSentFolder: boolean },
): Promise<Result<FolderOutcome, AppError>> {
  const inspected = await runtime.imap.inspectFolder({ path, signal: args.signal });
  if (!inspected.ok) {
    await recordImapFolderFailure(db, runtime, path, inspected.error.kind, args.signal);
    return err(
      new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "IMAP folder inspection failed", {
        reason: inspected.error.kind,
      }),
    );
  }
  const folder = await prepareImapFolder(
    db,
    runtime,
    path,
    { ...inspected.value, isSentFolder: args.isSentFolder },
    args.now,
    args.signal,
  );
  const stale: FolderOutcome = { applied: 0, skipped: 0, more: false, stale: true, usedPages: 0 };
  if (folder === null) return ok(stale);
  const reconciled = await reconcileImapFolder(db, runtime, folder, args.signal);
  if (!reconciled.ok)
    return err(
      new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "IMAP metadata reconciliation failed", {
        reason: reconciled.error.kind,
      }),
    );
  if (reconciled.value.stale) return ok(stale);
  return readPages(db, runtime, folder, args);
}
