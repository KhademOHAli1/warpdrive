/// <reference lib="es2023.intl" />
import type { IranianMoneyUnit } from "./iranianMoney";
import {
  displayNumberingSystem,
  localeWithNumberingSystem,
  type NumberingSystem,
} from "./numberingSystem";

export type FormattingLocale = "en" | "fa" | "de";
export type CalendarSystem = "gregory" | "persian";

export interface FormattingPreferences {
  locale: FormattingLocale;
  calendar: CalendarSystem;
  timeZone: string;
  numberingSystem?: NumberingSystem;
  iranianMoneyUnit?: IranianMoneyUnit;
}

export type DateDisplayOptions = Omit<
  Intl.DateTimeFormatOptions,
  "calendar" | "numberingSystem" | "timeZone"
>;

const LOCALE_TAGS: Record<FormattingLocale, string> = { en: "en-US", fa: "fa-IR", de: "de-DE" };
const MEDIUM_DATE: DateDisplayOptions = { year: "numeric", month: "short", day: "numeric" };

export function resolveFormattingPreferences(
  preferences: Partial<FormattingPreferences> = {},
): FormattingPreferences {
  const locale = preferences.locale ?? "en";
  return {
    locale,
    calendar: preferences.calendar ?? (locale === "fa" ? "persian" : "gregory"),
    timeZone: preferences.timeZone ?? "UTC",
    ...(preferences.iranianMoneyUnit === undefined
      ? {}
      : { iranianMoneyUnit: preferences.iranianMoneyUnit }),
    ...(preferences.numberingSystem === undefined
      ? {}
      : { numberingSystem: preferences.numberingSystem }),
  };
}

export function localeTagForFormatting(preferences: Partial<FormattingPreferences> = {}): string {
  return localeWithNumberingSystem(
    LOCALE_TAGS[preferences.locale ?? "en"],
    preferences.numberingSystem,
  );
}

export function formatNumber(
  value: number | string,
  preferences: Partial<FormattingPreferences> = {},
  options: Intl.NumberFormatOptions = {},
): string {
  if (!Number.isFinite(Number(value))) return "";
  return new Intl.NumberFormat(localeTagForFormatting(preferences), options).format(
    typeof value === "string" ? (value as Intl.StringNumericLiteral) : value,
  );
}

function dateFormatter(
  preferences: Partial<FormattingPreferences>,
  options: DateDisplayOptions,
  civilDate: boolean,
): Intl.DateTimeFormat {
  const resolved = resolveFormattingPreferences(preferences);
  return new Intl.DateTimeFormat(LOCALE_TAGS[resolved.locale], {
    ...options,
    calendar: resolved.calendar,
    numberingSystem: displayNumberingSystem(resolved),
    timeZone: civilDate ? "UTC" : resolved.timeZone,
  });
}

function parseCivilDate(value: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (parts === null) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(12, 0, 0, 0);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

// Civil dates carry no time zone. Formatting them at UTC noon keeps a saved close date
// on the same day even when the server and browser use different zones.
export function formatDateOnly(
  value: string,
  preferences: Partial<FormattingPreferences> = {},
  options: DateDisplayOptions = MEDIUM_DATE,
): string {
  const date = parseCivilDate(value);
  return date === null ? "" : dateFormatter(preferences, options, true).format(date);
}

export function formatDateTime(
  value: Date | string | number,
  preferences: Partial<FormattingPreferences> = {},
  options: DateDisplayOptions = { ...MEDIUM_DATE, hour: "2-digit", minute: "2-digit" },
): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : dateFormatter(preferences, options, false).format(date);
}
