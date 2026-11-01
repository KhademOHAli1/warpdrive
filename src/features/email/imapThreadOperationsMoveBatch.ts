import type { ImapOperationFolder } from "./imapThreadOperationsFolders";
import type { ImapMoveTarget } from "./imapThreadOperationsMoveTarget";
import type { ImapNetworkOutcome, ImapOperationLocator } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapMutationFence } from "./privateIntakeImapMutationFence";

export async function writeImapMoveBatch(
  runtime: ImapConnectionRuntime,
  folder: ImapOperationFolder,
  batch: ImapOperationLocator[],
  target: ImapMoveTarget,
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
  const outcome: ImapNetworkOutcome = {
    confirmed: batch.map((locator) => ({
      locator,
      flags: flags.get(locator.uid) ?? locator.flags,
      active: false,
    })),
    failure: null,
    movedCopies: [],
    requiresResync: false,
  };
  if (present.length === 0) return outcome;
  const moved = await runtime.imap.moveMessages({
    path: folder.path,
    uidValidity: folder.uidValidity,
    uids: present.map((row) => row.uid),
    destination: target.path,
    signal,
    beforeMutation,
  });
  if (!moved.ok) return { confirmed: [], failure: moved.error };
  if (moved.value.uidValidity === null) return { ...outcome, requiresResync: true };
  const validity = moved.value.uidValidity;
  const byUid = new Map(present.map((row) => [row.uid, row]));
  outcome.movedCopies = moved.value.uidMap.flatMap((mapping) => {
    const locator = byUid.get(mapping.sourceUid);
    return locator === undefined
      ? []
      : [
          {
            locator,
            path: target.path,
            uidValidity: validity,
            uid: mapping.destinationUid,
            flags: flags.get(locator.uid) ?? locator.flags,
            active: target.active,
          },
        ];
  });
  outcome.requiresResync = outcome.movedCopies.length !== present.length;
  return outcome;
}
