import { createTranslator } from "next-intl";
import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import german from "./messages/mailConnections.de.json";
import english from "./messages/mailConnections.en.json";
import persian from "./messages/mailConnections.fa.json";

const catalogs: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  fa: persian,
  de: german,
};

export function mailboxConnectionMessages(locale: Locale) {
  return catalogs[locale];
}

export function mailboxConnectionTranslator(locale: Locale, numberingSystem?: NumberingSystem) {
  return createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: catalogs[locale],
  });
}

export type MailboxConnectionMessages = ReturnType<typeof mailboxConnectionMessages>;
