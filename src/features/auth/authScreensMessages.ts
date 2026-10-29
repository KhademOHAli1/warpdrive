import type { Locale } from "@/features/i18n/registry";
import english from "./messages/authScreens.en.json";
import persian from "./messages/authScreens.fa.json";
export function authScreensMessagesForLocale(locale: Locale) {
  return locale === "fa" ? persian : english;
}
