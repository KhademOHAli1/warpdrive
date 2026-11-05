import { getRequestConfig } from "next-intl/server";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { messagesForLocale } from "./catalog";
import { getLocalePreferences } from "./server";

export default getRequestConfig(async () => {
  const preferences = await getLocalePreferences();
  return {
    locale: localeTagForFormatting(preferences),
    timeZone: preferences.timeZone,
    messages: messagesForLocale(preferences.locale),
  };
});
