import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import german from "./messages/privacyReviewer.de.json";
import english from "./messages/privacyReviewer.en.json";
import persian from "./messages/privacyReviewer.fa.json";

const catalogs: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  de: german,
  fa: persian,
};
export function privacyReviewerMessagesForLocale(locale: Locale) {
  return catalogs[locale];
}
