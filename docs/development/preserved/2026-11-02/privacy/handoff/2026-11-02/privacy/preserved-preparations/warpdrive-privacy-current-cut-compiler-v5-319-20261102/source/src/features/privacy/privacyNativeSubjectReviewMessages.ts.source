import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import german from "./messages/privacyNativeSubjectReview.de.json";
import english from "./messages/privacyNativeSubjectReview.en.json";
import persian from "./messages/privacyNativeSubjectReview.fa.json";

const catalogs: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  de: german,
  fa: persian,
};
export function privacyNativeSubjectReviewMessagesForLocale(locale: Locale) {
  return catalogs[locale];
}
export type NativeSubjectReviewMessages = ReturnType<
  typeof privacyNativeSubjectReviewMessagesForLocale
>;
