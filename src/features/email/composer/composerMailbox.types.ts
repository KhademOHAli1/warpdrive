import type { MailboxConnectionView } from "../connections/types";
export type ComposerMailbox = Pick<
  MailboxConnectionView,
  "id" | "emailAddress" | "displayName" | "isDefault" | "status" | "capabilities"
>;
export function sendableComposerMailboxes(mailboxes: ComposerMailbox[]): ComposerMailbox[] {
  return mailboxes.filter((mailbox) => mailbox.status === "connected" && mailbox.capabilities.send);
}
