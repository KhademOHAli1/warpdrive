import { useLocale } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import de from "./messages/workProfile.de.json";
import en from "./messages/workProfile.en.json";
import fa from "./messages/workProfile.fa.json";
export type WorkMessages = typeof en;
const messages: Record<Locale, WorkMessages> = { en, de, fa };
export function workMessagesForLocale(locale: Locale): WorkMessages {
  return messages[locale];
}
export function useWorkMessages(): WorkMessages {
  return workMessagesForLocale(useLocale());
}
