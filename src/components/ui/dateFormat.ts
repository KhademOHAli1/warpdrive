// Pure date-string helpers for the shared DatePicker. Value contract is local
// YYYY-MM-DD (matches the existing action inputs z.string().date() and the
// composer startDate state). Display order follows the interface language and chosen calendar.

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

export function formatMdy(v: string): string {
  const d = parseYmd(v);
  if (d === null) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

// The stored value is a Gregorian civil date, not an instant. Formatting at UTC noon
// avoids shifting that date when server and browser run in different time zones.
const dateFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
} as const;
const persianDateFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-persian-nu-arabext",
  dateFormatOptions,
);
const englishPersianDateFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-persian-nu-latn",
  dateFormatOptions,
);
const persianGregorianDateFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-gregory-nu-arabext",
  dateFormatOptions,
);
const germanDateFormatter = new Intl.DateTimeFormat(
  "de-DE-u-ca-gregory-nu-latn",
  dateFormatOptions,
);
const germanPersianDateFormatter = new Intl.DateTimeFormat(
  "de-DE-u-ca-persian-nu-latn",
  dateFormatOptions,
);
const accessibleDateOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  timeZone: "UTC",
} as const;
const solarAccessibleDateFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-persian-nu-arabext",
  accessibleDateOptions,
);
const gregorianAccessibleDateFormatter = new Intl.DateTimeFormat(
  "fa-IR-u-ca-gregory-nu-arabext",
  accessibleDateOptions,
);
const germanSolarAccessibleDateFormatter = new Intl.DateTimeFormat(
  "de-DE-u-ca-persian-nu-latn",
  accessibleDateOptions,
);
const germanGregorianAccessibleDateFormatter = new Intl.DateTimeFormat(
  "de-DE-u-ca-gregory-nu-latn",
  accessibleDateOptions,
);

function utcCivilDate(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
}

function formatCivilDate(v: string, formatter: Intl.DateTimeFormat): string {
  const date = parseYmd(v);
  if (date === null) return "";
  return formatter.format(utcCivilDate(date));
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatDmy(v: string): string {
  return formatCivilDate(v, germanDateFormatter);
}

export function formatPersianDate(
  v: string,
  locale: "en" | "fa" | "de" = "fa",
  numberingSystem?: "latn" | "arabext",
): string {
  if (locale === "de") {
    const date = parseYmd(v);
    if (date === null) return "";
    const parts = germanPersianDateFormatter.formatToParts(utcCivilDate(date));
    return `${datePart(parts, "day")}.${datePart(parts, "month")}.${datePart(parts, "year")}`;
  }
  return formatCivilDate(
    v,
    locale === "fa" && numberingSystem !== "latn"
      ? persianDateFormatter
      : englishPersianDateFormatter,
  );
}

export function formatGregorianPersianDate(
  v: string,
  numberingSystem?: "latn" | "arabext",
): string {
  return formatCivilDate(
    v,
    numberingSystem === "latn"
      ? new Intl.DateTimeFormat("fa-IR-u-ca-gregory-nu-latn", dateFormatOptions)
      : persianGregorianDateFormatter,
  );
}

export function formatPersianAccessibleDate(
  date: Date,
  calendar: "persian" | "gregory",
  modifiers?: Record<string, boolean>,
  numberingSystem?: "latn" | "arabext",
): string {
  const formatter =
    numberingSystem === "latn"
      ? new Intl.DateTimeFormat("fa-IR", { ...accessibleDateOptions, calendar, numberingSystem })
      : calendar === "persian"
        ? solarAccessibleDateFormatter
        : gregorianAccessibleDateFormatter;
  const parts = formatter.formatToParts(utcCivilDate(date));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? "";
  const formatted = `${part("weekday")}، ${part("day")} ${part("month")} ${part("year")}`;
  const withToday = modifiers?.today === true ? `امروز، ${formatted}` : formatted;
  return modifiers?.selected === true ? `${withToday}، انتخاب‌شده` : withToday;
}

export function formatGermanAccessibleDate(
  date: Date,
  calendar: "persian" | "gregory",
  modifiers?: Record<string, boolean>,
): string {
  const formatter =
    calendar === "persian"
      ? germanSolarAccessibleDateFormatter
      : germanGregorianAccessibleDateFormatter;
  const parts = formatter.formatToParts(utcCivilDate(date));
  const formatted = `${datePart(parts, "weekday")}, ${datePart(parts, "day")}. ${datePart(parts, "month")} ${datePart(parts, "year")}`;
  const withToday = modifiers?.today === true ? `Heute, ${formatted}` : formatted;
  return modifiers?.selected === true ? `${withToday}, ausgewählt` : withToday;
}

export function calendarFormatters(
  locale: "fa" | "de",
  calendar: "persian" | "gregory",
  numberingSystem: "latn" | "arabext",
) {
  const options = { calendar, numberingSystem, timeZone: "UTC" };
  const language = locale === "de" ? "de-DE" : "fa-IR";
  const month = new Intl.DateTimeFormat(language, { ...options, month: "long" });
  const year = new Intl.DateTimeFormat(language, { ...options, year: "numeric" });
  const format = (date: Date, formatter: Intl.DateTimeFormat, type: "month" | "year"): string =>
    datePart(formatter.formatToParts(utcCivilDate(date)), type);
  return {
    formatCaption: (date: Date) => `${format(date, month, "month")} ${format(date, year, "year")}`,
    formatMonthDropdown: (date: Date) => format(date, month, "month"),
    formatYearDropdown: (date: Date) => format(date, year, "year"),
  };
}
