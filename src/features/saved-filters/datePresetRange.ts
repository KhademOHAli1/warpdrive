import type { DatePresetKey } from "@/constants/dateFilterPresets";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  addCalendarMonths,
  startOfCalendarMonth,
  startOfCalendarWeek,
} from "@/features/activities/calendarSystem";
import { addDaysUtc } from "@/features/activities/monthGrid";

export interface DateFilterContext {
  timeZone?: string | null;
  calendar?: "gregory" | "persian";
  locale?: "en" | "fa" | "de";
  now?: Date;
}

export interface CivilDateRange {
  startDate: string;
  endDateExclusive: string;
}

export function validTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(value: string | null | undefined): string {
  return validTimeZone(value) ? value : "UTC";
}

function civilToday(now: Date, timeZone: string): Date {
  if (!Number.isFinite(now.getTime())) {
    throw new AppError(ERROR_IDS.DEAL_FILTER_INVALID, "Invalid date filter clock");
  }
  const parts = new Intl.DateTimeFormat("en-u-ca-gregory-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  // UTC here is a container for civil date arithmetic. It is not the viewer's midnight instant.
  return new Date(`${part("year").padStart(4, "0")}-${part("month")}-${part("day")}T00:00:00Z`);
}

// Boundaries remain Gregorian civil dates for SQL date columns and timezone conversion. The
// calendar changes month boundaries. The shared UI week rule starts on Saturday for Farsi or
// a selected Persian calendar, and Monday for English/German Gregorian calendars.
export function resolveDatePresetRange(
  preset: DatePresetKey,
  context: DateFilterContext = {},
): CivilDateRange {
  const today = civilToday(context.now ?? new Date(), resolveTimeZone(context.timeZone));
  const calendar = { calendar: context.calendar ?? "gregory" };
  const week = startOfCalendarWeek(today, { ...calendar, locale: context.locale ?? "en" });
  const month = startOfCalendarMonth(today, calendar);
  let start: Date;
  let end: Date;
  switch (preset) {
    case "today":
      start = today;
      end = addDaysUtc(today, 1);
      break;
    case "yesterday":
      start = addDaysUtc(today, -1);
      end = today;
      break;
    case "tomorrow":
      start = addDaysUtc(today, 1);
      end = addDaysUtc(today, 2);
      break;
    case "this_week":
      start = week;
      end = addDaysUtc(week, 7);
      break;
    case "last_week":
      start = addDaysUtc(week, -7);
      end = week;
      break;
    case "next_week":
      start = addDaysUtc(week, 7);
      end = addDaysUtc(week, 14);
      break;
    case "this_month":
      start = month;
      end = addCalendarMonths(month, 1, calendar);
      break;
    case "last_month":
      start = addCalendarMonths(month, -1, calendar);
      end = month;
      break;
    case "next_month":
      start = addCalendarMonths(month, 1, calendar);
      end = addCalendarMonths(start, 1, calendar);
      break;
    case "last_7_days":
      start = addDaysUtc(today, -6);
      end = addDaysUtc(today, 1);
      break;
    case "next_7_days":
      start = today;
      end = addDaysUtc(today, 7);
      break;
    case "last_30_days":
      start = addDaysUtc(today, -29);
      end = addDaysUtc(today, 1);
      break;
    case "next_30_days":
      start = today;
      end = addDaysUtc(today, 30);
      break;
  }
  return {
    startDate: start.toISOString().slice(0, 10),
    endDateExclusive: end.toISOString().slice(0, 10),
  };
}
