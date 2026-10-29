"use client";
import { useMemo } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { emailMessagesForLocale } from "./emailMessages";
export function useEmailMessages() {
  const { locale, numberingSystem } = useLocalePreferences();
  return useMemo(() => emailMessagesForLocale(locale, numberingSystem), [locale, numberingSystem]);
}
