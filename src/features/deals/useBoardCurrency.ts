"use client";

import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatToman } from "@/lib/iranianMoney";

export function useBoardCurrency(): (value: string, currency?: string) => string {
  const preferences = useLocalePreferences();
  // ICU versions disagree on en-DE currency placement. Use the German regional pattern
  // for Board amounts while keeping interface language and selected digits independent.
  const useGermanPattern = preferences.locale === "en" && preferences.country === "DE";
  if (!useGermanPattern) return (value, currency) => formatCurrency(value, currency, preferences);

  const germanPreferences = { ...preferences, locale: "de" as const };
  return (value, currency) => {
    if (currency === "IRR" && preferences.iranianMoneyUnit === "toman") {
      // Only the numeric pattern changes. Keep the English unit label.
      return formatToman(value, germanPreferences).replace(/Toman$/, "toman");
    }
    return formatCurrency(value, currency, germanPreferences);
  };
}
