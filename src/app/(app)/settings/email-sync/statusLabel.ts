import {
  type MailboxConnectionMessages,
  mailboxConnectionMessages,
} from "@/features/email/connections/messages";
import {
  type GmailMailboxDisplayHealth,
  type GmailMailboxHealthRow,
  gmailMailboxDisplayHealth,
} from "@/features/email/syncHealth";
import {
  type SettingsMessages,
  settingsMessagesForLocale,
} from "@/features/identity/settingsMessages";

export { gmailMailboxDisplayHealth as mailboxDisplayHealth };

export function mailboxStatusLabel(
  row: GmailMailboxHealthRow | null,
  now: Date | null,
  messages: SettingsMessages["_emailSync"] = settingsMessagesForLocale("en")._emailSync,
  mailboxCopy: MailboxConnectionMessages = mailboxConnectionMessages("en"),
): string {
  switch (gmailMailboxDisplayHealth(row, now)) {
    case "disconnected":
      return messages.statusDisconnected;
    case "stalled":
      return messages.statusStalled;
    case "syncing":
      return messages.statusConnected;
    case "paused":
      return mailboxCopy.paused;
    case "authorization-failed":
      return mailboxCopy.gmailAuthorizationRequired;
  }
}

export function mailboxDotClass(health: GmailMailboxDisplayHealth): string {
  if (health === "syncing") return "bg-green-500";
  if (health === "stalled") return "bg-warning";
  if (health === "authorization-failed") return "bg-destructive";
  return "bg-muted-foreground/40";
}
