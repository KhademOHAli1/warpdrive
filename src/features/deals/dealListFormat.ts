import { type FormattingPreferences, formatDateOnly, formatDateTime } from "@/lib/localeFormatting";

// Short activity date, tolerant of a Date or a serialized string crossing the SSR boundary.
export function fmtDate(
  d: Date | string | null,
  preferences: Partial<FormattingPreferences> = {},
): string {
  if (d === null) return "";
  return formatDateTime(d, preferences, { month: "short", day: "numeric", year: "numeric" });
}

// Expected close is a date-only column (YYYY-MM-DD). Parse the parts as a LOCAL date so a
// browser in a negative-UTC timezone does not render the previous day (new Date("2026-08-01")
// is parsed as UTC midnight, which would shift back a day west of Greenwich).
export function fmtDateOnly(
  d: string | null | undefined,
  preferences: Partial<FormattingPreferences> = {},
): string {
  if (d === null || d === undefined || d === "") return "";
  return formatDateOnly(d, preferences);
}
