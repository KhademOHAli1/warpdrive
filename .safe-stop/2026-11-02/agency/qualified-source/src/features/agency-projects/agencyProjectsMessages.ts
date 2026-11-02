import { createTranslator } from "next-intl";
import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import german from "./messages/agencyProjects.de.json";
import english from "./messages/agencyProjects.en.json";
import persian from "./messages/agencyProjects.fa.json";

const messagesByLocale = {
  en: english,
  fa: persian,
  de: german,
} satisfies Record<Locale, MessageCatalog<typeof english>>;

export function agencyProjectsTranslator(locale: Locale, numberingSystem?: NumberingSystem) {
  return createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: messagesByLocale[locale],
  });
}
