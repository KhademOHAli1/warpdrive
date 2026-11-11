"use client";

import { useLocale } from "@/features/i18n/LocaleProvider";
import de from "./messages.de.json";
import en from "./messages.en.json";
import fa from "./messages.fa.json";

export type AudienceMessages = typeof en;
const messages: Record<"en" | "de" | "fa", AudienceMessages> = { en, de, fa };

export function useAudienceMessages(): AudienceMessages {
  return messages[useLocale()];
}
