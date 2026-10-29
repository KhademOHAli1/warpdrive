"use client";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { createSalesStrings } from "./salesStrings";

export function useSalesStrings() {
  const preferences = useLocalePreferences();
  return createSalesStrings(preferences.locale, preferences.numberingSystem);
}
