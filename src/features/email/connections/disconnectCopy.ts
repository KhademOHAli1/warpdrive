import type { MailboxConnectionMessages } from "./messages";
import type { MailboxConnectionView } from "./types";

export function mailboxDisconnectDescription(
  messages: MailboxConnectionMessages,
  provider: MailboxConnectionView["provider"],
): string {
  return [
    messages.disconnectDescription,
    messages.disconnectQueued,
    provider === "imap_smtp" ? messages.disconnectManual : messages.disconnectGoogle,
  ].join(" ");
}
