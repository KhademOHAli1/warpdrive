import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import de from "./messages/authManagement.de.json";
import en from "./messages/authManagement.en.json";
import fa from "./messages/authManagement.fa.json";

const catalogs: Record<Locale, MessageCatalog<typeof en>> = { en, de, fa };
export function managementMessagesForLocale(locale: Locale) {
  return catalogs[locale];
}
export type ManagementMessages = ReturnType<typeof managementMessagesForLocale>;
