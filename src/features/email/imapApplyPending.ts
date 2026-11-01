import type { DbOrTx } from "@/server/realtime/channelVersions";
import type { ImapFolderCheckpoint, PreparedImapPage } from "./imapSyncTypes";
import { inspectSmtpSentCopy } from "./smtpMimeProof";

export async function imapPageHasPendingSentCopy(
  tx: DbOrTx,
  accountId: string,
  folder: ImapFolderCheckpoint,
  prepared: PreparedImapPage,
  signal: AbortSignal,
): Promise<boolean> {
  if (!folder.isSentFolder) return false;
  for (const message of prepared.messages) {
    const proof = await inspectSmtpSentCopy(tx, {
      accountId,
      isSentFolder: true,
      parsed: message.parsed,
      signal,
    });
    if (proof.kind === "pending") return true;
  }
  return false;
}
