import { displayNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import { addDaysUtc, addMonthsUtc, startOfDayUtc } from "./monthGrid";

export interface CalendarOptions {
  locale?: "en" | "fa" | "de";
  calendar?: "gregory" | "persian";
  numberingSystem?: NumberingSystem;
}

const persianDay = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
  day: "numeric",
  month: "numeric",
  timeZone: "UTC",
});
const DAY_MS = 24 * 60 * 60 * 1000;

function persianDayOfMonth(day: Date): number {
  return Number(persianDay.formatToParts(day).find((part) => part.type === "day")?.value);
}

function persianMonthOfYear(day: Date): number {
  return Number(persianDay.formatToParts(day).find((part) => part.type === "month")?.value);
}

export function calendarWeekStart(options: CalendarOptions = {}): 1 | 6 {
  return options.calendar === "persian" || options.locale === "fa" ? 6 : 1;
}

export function startOfCalendarWeek(day: Date, options: CalendarOptions = {}): Date {
  const offset = (day.getUTCDay() - calendarWeekStart(options) + 7) % 7;
  return addDaysUtc(startOfDayUtc(day), -offset);
}

export function startOfCalendarMonth(day: Date, options: CalendarOptions = {}): Date {
  return options.calendar === "persian"
    ? addDaysUtc(startOfDayUtc(day), 1 - persianDayOfMonth(day))
    : new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

export function addCalendarMonths(day: Date, delta: 1 | -1, options: CalendarOptions = {}): Date {
  if (options.calendar !== "persian") return addMonthsUtc(day, delta);
  const sourceStart = startOfCalendarMonth(day, options);
  // Calendar navigation moves exactly one month at a time. Every Iranian month has 29 to 31
  // days, so these fixed probes locate the adjacent month without a scan or UI/React imports.
  const target = startOfCalendarMonth(addDaysUtc(sourceStart, delta === 1 ? 32 : -1), options);
  const afterTarget = startOfCalendarMonth(addDaysUtc(target, 32), options);
  const targetLength = (afterTarget.getTime() - target.getTime()) / DAY_MS;
  return addDaysUtc(target, Math.min(persianDayOfMonth(day), targetLength) - 1);
}

export function startOfCalendarYear(day: Date, options: CalendarOptions = {}): Date {
  if (options.calendar !== "persian") {
    return new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  }
  const month = persianMonthOfYear(day);
  // The first six Iranian months have 31 days; the next five have 30. Esfand's
  // leap day changes the year length, but never the offset to a date in that year.
  const precedingDays = month <= 6 ? (month - 1) * 31 : 186 + (month - 7) * 30;
  return addDaysUtc(startOfDayUtc(day), -precedingDays - persianDayOfMonth(day) + 1);
}

export function addCalendarYears(day: Date, delta: 1 | -1, options: CalendarOptions = {}): Date {
  const sourceStart = startOfCalendarYear(day, options);
  // A year has 365 or 366 days in either supported calendar. These probes land
  // inside the adjacent year; resolving its actual start avoids a Nowruz guess.
  let target = startOfCalendarYear(addDaysUtc(sourceStart, delta === 1 ? 366 : -1), options);
  const monthIndex =
    options.calendar === "persian" ? persianMonthOfYear(day) - 1 : day.getUTCMonth();
  for (let month = 0; month < monthIndex; month++) {
    target = addCalendarMonths(target, 1, options);
  }
  const nextMonth = addCalendarMonths(target, 1, options);
  const targetLength = (nextMonth.getTime() - target.getTime()) / DAY_MS;
  const sourceDay = options.calendar === "persian" ? persianDayOfMonth(day) : day.getUTCDate();
  return addDaysUtc(target, Math.min(sourceDay, targetLength) - 1);
}

export function calendarYearMonths(anchor: Date, options: CalendarOptions = {}): Date[] {
  const months: Date[] = [];
  let start = startOfCalendarYear(anchor, options);
  for (let month = 0; month < 12; month++) {
    months.push(start);
    start = addCalendarMonths(start, 1, options);
  }
  return months;
}

export function isSameCalendarMonth(
  day: Date,
  anchor: Date,
  options: CalendarOptions = {},
): boolean {
  return (
    startOfCalendarMonth(day, options).getTime() === startOfCalendarMonth(anchor, options).getTime()
  );
}

function calendarFormatter(
  options: CalendarOptions,
  format: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const locale = options.locale === "fa" ? "fa-IR" : options.locale === "de" ? "de-DE" : "en-US";
  return new Intl.DateTimeFormat(locale, {
    ...format,
    calendar: options.calendar ?? "gregory",
    numberingSystem: displayNumberingSystem(options),
    timeZone: "UTC",
  });
}

export function formatCalendarDate(
  day: Date,
  options: CalendarOptions,
  format: Intl.DateTimeFormatOptions,
): string {
  return calendarFormatter(options, format).format(day);
}

export function calendarDateParts(
  day: Date,
  options: CalendarOptions,
  format: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormatPart[] {
  return calendarFormatter(options, format).formatToParts(day);
}

export function calendarWeekdayLabels(options: CalendarOptions = {}): string[] {
  // The reference week is only a deterministic source of weekday names, independent of the
  // calendar month/year being shown. Locale chooses labels; calendar/locale chooses week start.
  const first = startOfCalendarWeek(new Date("2026-03-23T00:00:00Z"), options);
  return Array.from({ length: 7 }, (_, i) =>
    formatCalendarDate(addDaysUtc(first, i), options, { weekday: "short" }),
  );
}
