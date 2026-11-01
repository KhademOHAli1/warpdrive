import type { ImapOperationFolder } from "./imapThreadOperationsFolders";
import type { ImapNetworkOutcome, ImapOperationLocator } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapMutationFence } from "./privateIntakeImapMutationFence";

function seenFlags(flags: string[], read: boolean): string[] {
  const rest = flags.filter((flag) => flag.toLowerCase() !== "\\seen");
  return read ? [...rest, "\\Seen"] : rest;
}

export async function writeImapReadBatch(
  runtime: ImapConnectionRuntime,
  folder: ImapOperationFolder,
  batch: ImapOperationLocator[],
  read: boolean,
  signal: AbortSignal,
  beforeMutation: ImapMutationFence,
): Promise<ImapNetworkOutcome> {
  const inspected = await runtime.imap.inspectMessages({
    path: folder.path,
    uidValidity: folder.uidValidity,
    uids: batch.map((row) => row.uid),
    signal,
  });
  if (!inspected.ok) return { confirmed: [], failure: inspected.error };
  const flags = new Map(inspected.value.messages.map((row) => [row.uid, row.flags]));
  const present = batch.filter((row) => flags.has(row.uid));
  if (present.length > 0) {
    const changed = await runtime.imap.setFlags({
      path: folder.path,
      uidValidity: folder.uidValidity,
      uids: present.map((row) => row.uid),
      flags: ["\\Seen"],
      mode: read ? "add" : "remove",
      signal,
      beforeMutation,
    });
    if (!changed.ok) return { confirmed: [], failure: changed.error };
  }
  return {
    confirmed: batch.map((locator) => ({
      locator,
      active: flags.has(locator.uid),
      flags: seenFlags(flags.get(locator.uid) ?? locator.flags, read),
    })),
    failure: null,
  };
}
