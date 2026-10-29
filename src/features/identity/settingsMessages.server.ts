import { getLocalePreferences } from "@/features/i18n/server";
import { settingsMessagesForLocale } from "./settingsMessages";

export async function getServerSettingsMessages() {
  const preferences = await getLocalePreferences();
  return settingsMessagesForLocale(preferences.locale, preferences.numberingSystem);
}
