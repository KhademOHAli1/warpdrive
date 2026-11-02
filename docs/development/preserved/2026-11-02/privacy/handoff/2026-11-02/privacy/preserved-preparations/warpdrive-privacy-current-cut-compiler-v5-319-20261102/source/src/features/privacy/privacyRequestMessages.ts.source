import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import german from "./messages/privacyRequest.de.json";
import english from "./messages/privacyRequest.en.json";
import persian from "./messages/privacyRequest.fa.json";

const catalogs: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  de: german,
  fa: persian,
};

export function privacyRequestMessagesForLocale(locale: Locale) {
  return catalogs[locale];
}
