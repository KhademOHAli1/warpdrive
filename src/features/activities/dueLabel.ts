import { type FormattingPreferences, formatDateOnly, formatDateTime } from "@/lib/localeFormatting";
import { instantCivilDate } from "@/lib/zonedDateTime";
export function fmtDue(
  iso: string | null,
  allDay: boolean,
  preferences: Partial<FormattingPreferences> = {},
  dueDate?: string | null,
): string {
  if (iso === null) return "-";
  return allDay
    ? formatDateOnly(dueDate ?? instantCivilDate(iso, preferences.timeZone), preferences, {
        month: "short",
        day: "numeric",
      })
    : formatDateTime(iso, preferences, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
