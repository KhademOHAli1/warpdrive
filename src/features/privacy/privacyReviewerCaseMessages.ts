import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import german from "./messages/privacyReviewerCase.de.json";
import english from "./messages/privacyReviewerCase.en.json";
import persian from "./messages/privacyReviewerCase.fa.json";

const catalogs: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  de: german,
  fa: persian,
};
export function privacyReviewerCaseMessagesForLocale(locale: Locale) {
  return catalogs[locale];
}
export type ReviewerCaseMessages = ReturnType<typeof privacyReviewerCaseMessagesForLocale>;
