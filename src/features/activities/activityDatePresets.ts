import type { CalendarSystem } from "@/features/i18n/preferences";
import { addCivilDays, instantCivilDate } from "@/lib/zonedDateTime";
import { startOfCalendarWeek } from "./calendarSystem";
// Quick time-preset date ranges for the activities list (A1). Each preset resolves to the
// filter's inclusive local-day bounds (from/to, "YYYY-MM-DD"); presets touch the date range
// only, orthogonal to the Status (open/done/all) dropdown. Week is Monday-first to match the
// in-app calendar. `today` is passed in so the logic stays pure and testable.

export type ActivityDatePreset = "overdue" | "today" | "this_week" | "todo";

export interface PresetRange {
  from: string | null;
  to: string | null;
}

export function presetRange(
  preset: ActivityDatePreset,
  today: Date,
  calendar: CalendarSystem = "gregory",
  timeZone = "UTC",
  locale: "en" | "fa" | "de" = "en",
): PresetRange {
  const day = instantCivilDate(today, timeZone);
  switch (preset) {
    case "today":
      return { from: day, to: day };
    case "overdue":
      return { from: null, to: addCivilDays(day, -1) };
    case "this_week": {
      const start = startOfCalendarWeek(new Date(`${day}T00:00:00Z`), { calendar, locale })
        .toISOString()
        .slice(0, 10);
      return { from: start, to: addCivilDays(start, 6) };
    }
    case "todo":
      return { from: null, to: null };
  }
}

// Which preset (if any) a given range corresponds to, for active-chip highlighting.
// Order matters: to-do (fully cleared) is checked before overdue (also from-null).
export function activePreset(
  range: PresetRange,
  today: Date,
  calendar: CalendarSystem = "gregory",
  timeZone = "UTC",
  locale: "en" | "fa" | "de" = "en",
): ActivityDatePreset | null {
  const presets: ActivityDatePreset[] = ["todo", "today", "overdue", "this_week"];
  for (const p of presets) {
    const r = presetRange(p, today, calendar, timeZone, locale);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return null;
}
