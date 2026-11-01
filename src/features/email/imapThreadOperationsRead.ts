import { imapOperationFolders, inspectWritableImapFolders } from "./imapThreadOperationsFolders";
import { writeImapReadBatch } from "./imapThreadOperationsReadBatch";
import type { ImapNetworkOutcome, ImapOperationLocator } from "./imapThreadOperationsTypes";
import type { ImapConnectionRuntime } from "./mailConnectionRuntime";
import type { ImapMutationFence } from "./privateIntakeImapMutationFence";

export async function writeImapReadState(
  runtime: ImapConnectionRuntime,
  rows: ImapOperationLocator[],
  read: boolean,
  signal: AbortSignal,
  beforeMutation: ImapMutationFence,
): Promise<ImapNetworkOutcome> {
  const folders = imapOperationFolders(rows);
  const failure = await inspectWritableImapFolders(runtime, folders, signal);
  const outcome: ImapNetworkOutcome = { confirmed: [], failure };
  if (failure !== null) return outcome;
  for (const folder of folders) {
    for (let offset = 0; offset < folder.rows.length; offset += 100) {
      const result = await writeImapReadBatch(
        runtime,
        folder,
        folder.rows.slice(offset, offset + 100),
        read,
        signal,
        beforeMutation,
      );
      outcome.confirmed.push(...result.confirmed);
      if (result.failure !== null) return { ...outcome, failure: result.failure };
    }
  }
  return outcome;
}
