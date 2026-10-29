import { type FormattingPreferences, formatDateTime } from "@/lib/localeFormatting";

export function formatCreatedOn(iso: string, preferences?: FormattingPreferences): string {
  return formatDateTime(iso, preferences, { year: "numeric", month: "short", day: "numeric" });
}
