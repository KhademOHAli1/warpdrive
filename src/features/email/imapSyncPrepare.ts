import type { PreparedImapPage } from "./imapSyncTypes";
import { imapMessageFingerprint } from "./imapThreading";
import type { ImapFolderPage } from "./providers/imapTypes";
import { parseRawMime } from "./providers/rawMime";

export async function prepareImapPage(
  accountId: string,
  page: ImapFolderPage,
  signal: AbortSignal,
): Promise<PreparedImapPage> {
  const prepared: PreparedImapPage = { page, messages: [], skipped: [...page.skipped] };
  for (const message of page.messages) {
    const parsed = await parseRawMime({ source: message.source, signal });
    signal.throwIfAborted();
    if (!parsed.ok)
      prepared.skipped.push({
        uid: message.uid,
        reason: parsed.error.kind.endsWith("too_large") ? "message_too_large" : "invalid_message",
      });
    else
      prepared.messages.push({
        uid: message.uid,
        flags: message.flags,
        internalDate: message.internalDate,
        fingerprint: imapMessageFingerprint(accountId, message.source),
        parsed: parsed.value,
      });
  }
  return prepared;
}
