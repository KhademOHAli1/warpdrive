import { getRequestConfig } from "next-intl/server";
import { localeWithNumberingSystem } from "@/lib/numberingSystem";
import { messagesForLocale } from "./catalog";
import { getLocalePreferences } from "./server";

export default getRequestConfig(async () => {
  const preferences = await getLocalePreferences();
  return {
    locale: localeWithNumberingSystem(preferences.locale, preferences.numberingSystem),
    timeZone: preferences.timeZone,
    messages: messagesForLocale(preferences.locale),
  };
});
