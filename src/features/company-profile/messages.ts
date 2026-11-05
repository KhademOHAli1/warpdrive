import { useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import de from "./messages/companyProfile.de.json";
import en from "./messages/companyProfile.en.json";
import fa from "./messages/companyProfile.fa.json";
export type CompanyMessages = typeof en;
const messages: Record<Locale, CompanyMessages> = { en, de, fa };
export function companyMessagesForLocale(locale: Locale): CompanyMessages {
  return messages[locale];
}
export function useCompanyMessages(): CompanyMessages {
  return companyMessagesForLocale(useLocale());
}
