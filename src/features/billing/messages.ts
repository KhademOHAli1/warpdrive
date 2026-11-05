import type { Locale } from "@/features/i18n/registry";
import german from "./messages/billing.de.json";
import english from "./messages/billing.en.json";
import persian from "./messages/billing.fa.json";

export type BillingMessages = typeof english;

const catalogs: Record<Locale, BillingMessages> = {
  en: english,
  de: german,
  fa: persian,
};

export function billingMessagesForLocale(locale: Locale): BillingMessages {
  return catalogs[locale];
}
