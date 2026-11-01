import de from "./messages/composerMailbox.de.json";
import en from "./messages/composerMailbox.en.json";
import fa from "./messages/composerMailbox.fa.json";

export type ComposerMailboxMessages = typeof en;
export function composerMailboxMessages(locale: string): ComposerMailboxMessages {
  return locale === "fa" ? fa : locale === "de" ? de : en;
}
