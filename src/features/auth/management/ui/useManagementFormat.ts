"use client";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { localeWithNumberingSystem } from "@/lib/numberingSystem";
export function useManagementFormat() {
  const preferences = useLocalePreferences();
  const locale = localeWithNumberingSystem(preferences.locale, preferences.numberingSystem);
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: preferences.timeZone,
    calendar: preferences.calendar === "persian" ? "persian" : "gregory",
  });
  return {
    number: (value: number) => number.format(value),
    date: (value: string) => date.format(new Date(value)),
  };
}
