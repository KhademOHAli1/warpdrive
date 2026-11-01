"use client";

import { useMemo } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatCurrency } from "./formatCurrency";
import {
  type DateDisplayOptions,
  formatDateOnly,
  formatDateTime,
  formatNumber,
} from "./localeFormatting";

export function useFormatters() {
  const { locale, calendar, timeZone, numberingSystem, iranianMoneyUnit } = useLocalePreferences();
  return useMemo(() => {
    const preferences = { locale, calendar, timeZone, numberingSystem, iranianMoneyUnit };
    return {
      currency: (value: number | string, currency = "USD"): string =>
        formatCurrency(value, currency, preferences),
      number: (value: number | string, options?: Intl.NumberFormatOptions): string =>
        formatNumber(value, preferences, options),
      dateOnly: (value: string, options?: DateDisplayOptions): string =>
        formatDateOnly(value, preferences, options),
      dateTime: (value: Date | string | number, options?: DateDisplayOptions): string =>
        formatDateTime(value, preferences, options),
    };
  }, [locale, calendar, timeZone, numberingSystem, iranianMoneyUnit]);
}
