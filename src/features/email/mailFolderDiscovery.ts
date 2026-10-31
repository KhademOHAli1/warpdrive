import { err, ok } from "@/types/result";
import type { MailboxConnectionResult, MailboxFolder } from "./connections/types";
import { mailTransportFailure } from "./mailConnectionTransport";
import type { createImapTransport } from "./providers/imap";

type ImapTransport = ReturnType<typeof createImapTransport>;
type FolderList = Extract<Awaited<ReturnType<ImapTransport["listFolders"]>>, { ok: true }>["value"];

export async function discoverMailFolders(
  imap: ImapTransport,
  listed: FolderList,
  signal: AbortSignal,
): Promise<MailboxConnectionResult<{ folders: MailboxFolder[]; trashWritable: boolean }>> {
  const folders: MailboxFolder[] = [];
  const trashWritable = await hasWritableTrash(imap, listed, signal);
  for (const folder of listed.folders.filter((row) => row.selectable).slice(0, 1000)) {
    if (folder.authoritativeSpecialUse && ["\\Trash", "\\Junk"].includes(folder.specialUse ?? ""))
      continue;
    const role = folderRole(folder);
    let readOnly: boolean | null = null;
    if (role !== "other") {
      const inspected = await imap.inspectFolder({ path: folder.path, signal });
      if (!inspected.ok) return err(mailTransportFailure(inspected.error.kind));
      readOnly = inspected.value.readOnly;
    }
    folders.push({ path: folder.path, name: folder.name, role, readOnly });
  }
  return ok({ folders, trashWritable });
}

type Folder = FolderList["folders"][number];
function folderRole(folder: Folder): MailboxFolder["role"] {
  if (folder.path.toUpperCase() === "INBOX") return "inbox";
  return folder.authoritativeSpecialUse && folder.specialUse === "\\Sent" ? "sent" : "other";
}
async function hasWritableTrash(
  imap: ImapTransport,
  listed: FolderList,
  signal: AbortSignal,
): Promise<boolean> {
  const folders = listed.folders.filter(
    (folder) =>
      folder.selectable && folder.authoritativeSpecialUse && folder.specialUse === "\\Trash",
  );
  const folder = folders[0];
  if (!listed.canMove || folders.length !== 1 || folder === undefined) return false;
  const inspected = await imap.inspectFolder({ path: folder.path, signal });
  return inspected.ok && !inspected.value.readOnly;
}
