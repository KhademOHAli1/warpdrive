import type { MailboxConnectionMessages } from "./messages";
import type { MailboxFolder } from "./types";

export function mailboxFolderLabel(folder: MailboxFolder, L: MailboxConnectionMessages): string {
  if (folder.role === "inbox") return L.inbox;
  if (folder.role === "sent") return L.sent;
  return folder.name;
}
