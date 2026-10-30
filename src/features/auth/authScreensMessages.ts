import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import german from "./messages/authScreens.de.json";
import english from "./messages/authScreens.en.json";
import persian from "./messages/authScreens.fa.json";

const messagesByLocale: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  fa: persian,
  de: german,
};

export function authScreensMessagesForLocale(locale: Locale) {
  return messagesByLocale[locale];
}
