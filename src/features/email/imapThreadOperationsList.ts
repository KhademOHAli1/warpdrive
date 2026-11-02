import { eq } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { mailFolders } from "@/db/schema/mailRemote";
import type { AuthUser } from "@/features/permissions/types";
import { err, ok, type Result } from "@/types/result";
import { loadImapOperation } from "./imapThreadOperationsContext";
import type { ImapThreadOperationDeps } from "./imapThreadOperationsTypes";
import { isMailConnectionCurrent } from "./mailConnectionRuntime";

export interface ImapMoveFolder {
  path: string;
  name: string;
  readOnly: boolean | null;
  selected: boolean;
}

export async function listImapMoveFolders(
  db: Db,
  args: { actor: AuthUser; threadId: string },
  signal: AbortSignal,
  deps: ImapThreadOperationDeps = {},
): Promise<Result<{ folders: ImapMoveFolder[] }, AppError>> {
  const loaded = await loadImapOperation(db, args.actor, args.threadId, signal, deps);
  if (!loaded.ok) return loaded;
  const runtime = loaded.value;
  const listed = await runtime.imap.listFolders({ signal });
  if (!listed.ok)
    return err(new AppError(ERROR_IDS.MAIL_CONNECTION_UNAVAILABLE, "mailbox folders unavailable"));
  if (!(await isMailConnectionCurrent(db, runtime, signal)))
    return err(new AppError(ERROR_IDS.MAIL_CONNECTION_CHANGED, "mailbox changed"));
  if (!listed.value.canMove)
    return err(new AppError(ERROR_IDS.MAIL_CAPABILITY_DENIED, "mailbox move unsupported"));
  const known = await db
    .select({ path: mailFolders.path, readOnly: mailFolders.readOnly })
    .from(mailFolders)
    .where(eq(mailFolders.accountId, runtime.accountId));
  signal.throwIfAborted();
  const modes = new Map(known.map((folder) => [folder.path, folder.readOnly]));
  const folders = listed.value.folders
    .filter(
      (folder) =>
        folder.selectable &&
        !(
          folder.authoritativeSpecialUse &&
          (folder.specialUse === "\\Trash" || folder.specialUse === "\\Junk")
        ),
    )
    .slice(0, 1000)
    .map((folder) => ({
      path: folder.path,
      name: folder.name,
      readOnly: modes.get(folder.path) ?? null,
      selected: runtime.folderPaths.includes(folder.path),
    }));
  return ok({ folders });
}
