import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { err, ok, type Result } from "@/types/result";
import { syncImapFolder } from "./imapSyncFolder";
import { imapFolderOrder } from "./imapSyncFolders";
import type { ImapSyncDependencies, ImapSyncOutcome } from "./imapSyncTypes";
import { loadImapConnection } from "./mailConnectionRuntime";

const DEFAULT_PAGE_BUDGET = 4;

export async function runImapSyncJob(
  db: Db,
  args: { accountId: string; signal: AbortSignal; now?: Date },
  deps: ImapSyncDependencies = {},
): Promise<Result<ImapSyncOutcome, AppError>> {
  args.signal.throwIfAborted();
  const loaded = await (deps.loadConnection ?? loadImapConnection)(db, args.accountId, args.signal);
  if (!loaded.ok) return loaded;
  const runtime = loaded.value;
  const outcome: ImapSyncOutcome = { applied: 0, skipped: 0, more: false, stale: false };
  let budget = deps.maxPages ?? DEFAULT_PAGE_BUDGET;
  const now = args.now ?? new Date();
  try {
    const listed = await runtime.imap.listFolders({ signal: args.signal });
    if (!listed.ok)
      return err(
        new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "IMAP folder discovery failed", {
          reason: listed.error.kind,
        }),
      );
    const sentPaths = new Set(
      listed.value.folders
        .filter((folder) => folder.specialUse === "\\Sent" && folder.authoritativeSpecialUse)
        .map((folder) => folder.path),
    );
    const paths = await imapFolderOrder(db, runtime, args.signal);
    const excluded = new Set(
      listed.value.folders
        .filter(
          (folder) =>
            folder.authoritativeSpecialUse &&
            (folder.specialUse === "\\Trash" || folder.specialUse === "\\Junk"),
        )
        .map((folder) => folder.path),
    );
    for (const path of paths.filter((path) => !excluded.has(path))) {
      if (budget <= 0) {
        outcome.more = true;
        break;
      }
      const result = await syncImapFolder(db, runtime, path, {
        now,
        budget,
        signal: args.signal,
        isSentFolder: sentPaths.has(path),
      });
      if (!result.ok) return result;
      outcome.applied += result.value.applied;
      outcome.skipped += result.value.skipped;
      outcome.more ||= result.value.more;
      budget -= result.value.usedPages;
      if (result.value.deferred === true) return ok({ ...outcome, deferred: true });
      if (result.value.stale) return ok({ ...outcome, stale: true });
    }
    return ok(outcome);
  } catch (error) {
    args.signal.throwIfAborted();
    return err(
      error instanceof AppError
        ? error
        : new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "IMAP synchronization failed"),
    );
  }
}
