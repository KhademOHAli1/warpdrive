import { imapOperationFolders, inspectWritableImapFolders } from "./imapThreadOperationsFolders";
import { writeImapMoveBatch } from "./imapThreadOperationsMoveBatch";
import { imapMoveTarget } from "./imapThreadOperationsMoveTarget";
import type {
  ImapNetworkOutcome,
  ImapOperationLocator,
  ImapThreadOperation,
} from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapMutationFence } from "./privateIntakeImapMutationFence";

export async function writeImapMoveState(
  runtime: ImapConnectionRuntime,
  rows: ImapOperationLocator[],
  operation: Exclude<ImapThreadOperation, { kind: "read" }>,
  signal: AbortSignal,
  beforeMutation: ImapMutationFence,
): Promise<ImapNetworkOutcome> {
  const target = await imapMoveTarget(runtime, operation, signal);
  if (!target.ok) return { confirmed: [], failure: target.error };
  const folders = imapOperationFolders(rows).filter((folder) => folder.path !== target.value.path);
  const failure = await inspectWritableImapFolders(runtime, folders, signal);
  const outcome: ImapNetworkOutcome = {
    confirmed: [],
    failure,
    movedCopies: [],
    trash: target.value.trash,
    requiresResync: false,
  };
  if (failure !== null) return outcome;
  if (target.value.trash)
    outcome.confirmed.push(
      ...rows
        .filter((row) => row.path === target.value.path)
        .map((locator) => ({ locator, flags: locator.flags, active: false })),
    );
  for (const folder of folders) {
    for (let offset = 0; offset < folder.rows.length; offset += 100) {
      const result = await writeImapMoveBatch(
        runtime,
        folder,
        folder.rows.slice(offset, offset + 100),
        target.value,
        signal,
        beforeMutation,
      );
      outcome.confirmed.push(...result.confirmed);
      outcome.movedCopies?.push(...(result.movedCopies ?? []));
      outcome.requiresResync ||= result.requiresResync === true;
      if (result.failure !== null) return { ...outcome, failure: result.failure };
    }
  }
  return outcome;
}
