// Pure date-string helpers for the shared DatePicker. Value contract is local
// YYYY-MM-DD (matches the existing action inputs z.string().date() and the
// composer startDate state). Display order follows the interface language and chosen calendar.
import { displayNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";

export function toYmd(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseYmd(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m === null) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  // new Date(y, m, d) silently rolls invalid parts into the next
  // month/year (e.g. Feb 30 -> Mar 2); round-trip the parts to reject
  // out-of-range calendar values instead of accepting a rolled-over date.
  const isSameCalendarDate =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return isSameCalendarDate ? date : null;
}

// The stored value is a Gregorian civil date, not an instant. Formatting at UTC noon
// avoids shifting that date when server and browser run in different time zones.
const DATE_LOCALES = { en: "en-US", fa: "fa-IR", de: "de-DE" } as const;
const DATE_STYLES = {
  numeric: { year: "numeric", month: "2-digit", day: "2-digit" },
  accessible: { year: "numeric", month: "long", day: "numeric", weekday: "long" },
  month: { month: "long" },
  year: { year: "numeric" },
} as const;
type DateLocale = keyof typeof DATE_LOCALES;
type DateCalendar = "gregory" | "persian";
type DateStyle = keyof typeof DATE_STYLES;
type FormatterKey = `${DateLocale}:${DateCalendar}:${NumberingSystem}:${DateStyle}`;

// Only finite display preferences enter the cache, never dates or arbitrary locale strings.
const dateFormatters = new Map<FormatterKey, Intl.DateTimeFormat>();

function formatterFor(
  locale: DateLocale,
  calendar: DateCalendar,
  style: DateStyle,
  numberingSystem?: NumberingSystem,
): Intl.DateTimeFormat {
  const numbers = displayNumberingSystem({ locale, numberingSystem });
  const key: FormatterKey = `${locale}:${calendar}:${numbers}:${style}`;
  const cached = dateFormatters.get(key);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat(DATE_LOCALES[locale], {
    ...DATE_STYLES[style],
    calendar,
    numberingSystem: numbers,
    timeZone: "UTC",
  });
  dateFormatters.set(key, formatter);
  return formatter;
}

function utcCivilDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
}

function numericDateParts(
  v: string,
  locale: DateLocale,
  calendar: DateCalendar,
  numberingSystem?: NumberingSystem,
): Intl.DateTimeFormatPart[] | null {
  const date = parseYmd(v);
  return date === null
    ? null
    : formatterFor(locale, calendar, "numeric", numberingSystem).formatToParts(utcCivilDate(date));
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatMdy(v: string, numberingSystem?: NumberingSystem): string {
  const parts = numericDateParts(v, "en", "gregory", numberingSystem);
  return parts === null
    ? ""
    : `${datePart(parts, "month")}/${datePart(parts, "day")}/${datePart(parts, "year")}`;
}

export function formatDmy(v: string, numberingSystem?: NumberingSystem): string {
  const parts = numericDateParts(v, "de", "gregory", numberingSystem);
  return parts === null
    ? ""
    : `${datePart(parts, "day")}.${datePart(parts, "month")}.${datePart(parts, "year")}`;
}

export function formatPersianDate(
  v: string,
  locale: DateLocale = "fa",
  numberingSystem?: NumberingSystem,
): string {
  const parts = numericDateParts(v, locale, "persian", numberingSystem);
  if (parts === null) return "";
  if (locale === "de") {
    return `${datePart(parts, "day")}.${datePart(parts, "month")}.${datePart(parts, "year")}`;
  }
  return `${datePart(parts, "year")}/${datePart(parts, "month")}/${datePart(parts, "day")}`;
}

export function formatGregorianPersianDate(v: string, numberingSystem?: NumberingSystem): string {
  const parts = numericDateParts(v, "fa", "gregory", numberingSystem);
  return parts === null
    ? ""
    : `${datePart(parts, "year")}/${datePart(parts, "month")}/${datePart(parts, "day")}`;
}

export function formatPersianAccessibleDate(
  date: Date,
  calendar: DateCalendar,
  modifiers?: Record<string, boolean>,
  numberingSystem?: NumberingSystem,
): string {
  const formatter = formatterFor("fa", calendar, "accessible", numberingSystem);
  const parts = formatter.formatToParts(utcCivilDate(date));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  const formatted = `${part("weekday")}، ${part("day")} ${part("month")} ${part("year")}`;
  const withToday = modifiers?.today === true ? `امروز، ${formatted}` : formatted;
  return modifiers?.selected === true ? `${withToday}، انتخاب‌شده` : withToday;
}

export function formatGermanAccessibleDate(
  date: Date,
  calendar: DateCalendar,
  modifiers?: Record<string, boolean>,
  numberingSystem?: NumberingSystem,
): string {
  const formatter = formatterFor("de", calendar, "accessible", numberingSystem);
  const parts = formatter.formatToParts(utcCivilDate(date));
  const formatted = `${datePart(parts, "weekday")}, ${datePart(parts, "day")}. ${datePart(parts, "month")} ${datePart(parts, "year")}`;
  const withToday = modifiers?.today === true ? `Heute, ${formatted}` : formatted;
  return modifiers?.selected === true ? `${withToday}, ausgewählt` : withToday;
}

export function calendarFormatters(
  locale: "fa" | "de",
  calendar: DateCalendar,
  numberingSystem: NumberingSystem,
) {
  const month = formatterFor(locale, calendar, "month", numberingSystem);
  const year = formatterFor(locale, calendar, "year", numberingSystem);
  const format = (date: Date, formatter: Intl.DateTimeFormat, type: "month" | "year"): string =>
    datePart(formatter.formatToParts(utcCivilDate(date)), type);
  return {
    formatCaption: (date: Date) => `${format(date, month, "month")} ${format(date, year, "year")}`,
    formatMonthDropdown: (date: Date) => format(date, month, "month"),
    formatYearDropdown: (date: Date) => format(date, year, "year"),
  };
}
