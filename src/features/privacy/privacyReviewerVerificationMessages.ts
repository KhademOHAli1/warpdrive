import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import german from "./messages/privacyReviewerVerification.de.json";
import english from "./messages/privacyReviewerVerification.en.json";
import persian from "./messages/privacyReviewerVerification.fa.json";

const catalogs: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  de: german,
  fa: persian,
};
export function privacyReviewerVerificationMessagesForLocale(locale: Locale) {
  return catalogs[locale];
}
