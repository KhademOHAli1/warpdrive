import { getLocalePreferences } from "@/features/i18n/server";
import { statsMessagesForLocale } from "./statsMessages";
export async function getStatsMessages() {
  return statsMessagesForLocale((await getLocalePreferences()).locale);
}
