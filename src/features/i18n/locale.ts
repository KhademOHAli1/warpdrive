// Compatibility exports while existing screens move to namespaced ICU translations.
export { messagesForLocale } from "./catalog";
export { LOCALE_COOKIE, type LocalePreferences } from "./preferences";
export { directionForLocale, type Locale, parseLocale } from "./registry";
