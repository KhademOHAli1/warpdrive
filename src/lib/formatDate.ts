import { type FormattingPreferences, formatDateOnly } from "./localeFormatting";

export function formatMediumDate(
  ymd: string,
  preferences: Partial<FormattingPreferences> = {},
): string {
  return formatDateOnly(ymd, preferences) || ymd;
}
