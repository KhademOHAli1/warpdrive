import type { ImapOperationLocator } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapFailure } from "./providers/imapTypes";

export interface ImapOperationFolder {
  folderId: string;
  path: string;
  uidValidity: string;
  rows: ImapOperationLocator[];
}

export function imapOperationFolders(rows: ImapOperationLocator[]): ImapOperationFolder[] {
  const folders = new Map<string, ImapOperationFolder>();
  for (const row of rows) {
    const current = folders.get(row.folderId);
    if (current === undefined)
      folders.set(row.folderId, {
        folderId: row.folderId,
        path: row.path,
        uidValidity: row.uidValidity,
        rows: [row],
      });
    else current.rows.push(row);
  }
  return [...folders.values()];
}

export async function inspectWritableImapFolders(
  runtime: ImapConnectionRuntime,
  folders: ImapOperationFolder[],
  signal: AbortSignal,
): Promise<ImapFailure | null> {
  for (const folder of folders) {
    const inspected = await runtime.imap.inspectFolder({ path: folder.path, signal });
    if (!inspected.ok) return inspected.error;
    if (inspected.value.readOnly) return { kind: "read_only" };
    if (inspected.value.uidValidity !== folder.uidValidity) return { kind: "uidvalidity_changed" };
  }
  return null;
}
