import {
  type FormattingPreferences,
  formatDateOnly,
  formatDateTime,
  formatNumber,
} from "@/lib/localeFormatting";

const EXAMPLE_DATE = "2026-03-21";
const EXAMPLE_INSTANT = "2026-03-21T09:30:00Z";

export function formatRegionalPreview(preferences: FormattingPreferences) {
  return {
    date: formatDateOnly(EXAMPLE_DATE, preferences),
    localDate: formatDateTime(EXAMPLE_INSTANT, preferences, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }),
    time: formatDateTime(EXAMPLE_INSTANT, preferences, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    number: formatNumber(12345.67, preferences),
  };
}

export type RegionalPreview = ReturnType<typeof formatRegionalPreview>;
