import {
  calendarYearMonths,
  startOfCalendarMonth,
  startOfCalendarYear,
} from "@/features/activities/calendarSystem";
import { addDaysUtc } from "@/features/activities/monthGrid";
import type { CalendarSystem } from "@/features/i18n/preferences";

export type DatePreset = "month" | "quarter" | "year" | "last30";

function startOfCalendarQuarter(day: Date, calendar: CalendarSystem): Date {
  let start = startOfCalendarYear(day, { calendar });
  // Quarters begin with months 1, 4, 7 and 10 of the selected calendar. The canonical
  // calendar helper supplies real civil boundaries, including the Iranian leap year.
  for (const [index, month] of calendarYearMonths(day, { calendar }).entries()) {
    if (index % 3 === 0 && month.getTime() <= day.getTime()) start = month;
  }
  return start;
}

// `today` is the viewer's server-resolved Gregorian ISO civil date. UTC is only
// an arithmetic container here; the reporting query resolves the actual zoned midnights.
// Calendar selection is independent of language, and existing callers default to Gregorian.
export function presetRange(
  preset: DatePreset,
  today: string,
  calendar: CalendarSystem = "gregory",
): { from: string; to: string } {
  const day = new Date(`${today}T00:00:00Z`);
  let start: Date;
  switch (preset) {
    case "month":
      start = startOfCalendarMonth(day, { calendar });
      break;
    case "quarter":
      start = startOfCalendarQuarter(day, calendar);
      break;
    case "last30":
      start = addDaysUtc(day, -29);
      break;
    case "year":
      start = startOfCalendarYear(day, { calendar });
      break;
  }
  return { from: start.toISOString().slice(0, 10), to: today };
}
