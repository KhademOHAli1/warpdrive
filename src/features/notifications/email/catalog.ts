import { createTranslator } from "use-intl/core";
import { mergeMessages } from "@/features/i18n/mergeMessages";
import type { Locale } from "@/features/i18n/registry";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import german from "../messages/notificationEmail.de.json";
import english from "../messages/notificationEmail.en.json";
import persian from "../messages/notificationEmail.fa.json";

// Keep worker mail messages independent of UI-only namespace registration/copy.
// This is the same English/blank-translation fallback used by the application catalog.
const messages = {
  en: english,
  de: mergeMessages(english, german),
  fa: mergeMessages(english, persian),
} satisfies Record<Locale, typeof english>;

export function notificationEmailMessagesForLocale(locale: Locale): typeof english {
  return messages[locale];
}

export function createNotificationEmailTranslator(locale: Locale) {
  return createTranslator({
    locale: localeTagForFormatting({ locale }),
    messages: notificationEmailMessagesForLocale(locale),
  });
}
