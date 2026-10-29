import { displayNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import { addDaysUtc, addMonthsUtc, startOfDayUtc } from "./monthGrid";

export interface CalendarOptions {
  locale?: "en" | "fa" | "de";
  calendar?: "gregory" | "persian";
  numberingSystem?: NumberingSystem;
}

const persianDay = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", {
  day: "numeric",
  timeZone: "UTC",
});
const DAY_MS = 24 * 60 * 60 * 1000;

function persianDayOfMonth(day: Date): number {
  return Number(persianDay.formatToParts(day).find((part) => part.type === "day")?.value);
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
