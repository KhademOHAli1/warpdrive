import { getLocalePreferences } from "@/features/i18n/server";
import { emailMessagesForLocale } from "./emailMessages";
export async function getEmailMessages() {
  return emailMessagesForLocale((await getLocalePreferences()).locale);
}
