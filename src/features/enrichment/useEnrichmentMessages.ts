"use client";
import { useMemo } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { enrichmentMessagesForLocale } from "./enrichmentMessages";

export function useEnrichmentMessages() {
  const { locale, numberingSystem } = useLocalePreferences();
  return useMemo(
    () => enrichmentMessagesForLocale(locale, numberingSystem),
    [locale, numberingSystem],
  );
}
