"use client";
import { useMemo } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { statsMessagesForLocale } from "./statsMessages";
export function useStatsMessages() {
  const { locale, numberingSystem } = useLocalePreferences();
  return useMemo(() => statsMessagesForLocale(locale, numberingSystem), [locale, numberingSystem]);
}
