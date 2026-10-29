"use client";
import { useMemo } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { activitiesMessagesForLocale } from "./activitiesMessages";
export function useActivitiesMessages() {
  const { locale, numberingSystem } = useLocalePreferences();
  return useMemo(
    () => activitiesMessagesForLocale(locale, numberingSystem),
    [locale, numberingSystem],
  );
}
