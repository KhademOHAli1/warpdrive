"use client";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { composerMailboxMessages } from "./mailboxMessages";
export function useComposerMailboxMessages() {
  return composerMailboxMessages(useLocalePreferences().locale);
}
