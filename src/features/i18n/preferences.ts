import { z } from "zod";
import type { IranianMoneyUnit } from "@/lib/iranianMoney";
import { NUMBERING_SYSTEMS, type NumberingSystem } from "@/lib/numberingSystem";
import { regionalFormatDefaults } from "./regionalContext";
import { isRegionalCountry } from "./regionalCountries";
import { LOCALE_REGISTRY, type Locale, parseLocale, SELECTABLE_LOCALES } from "./registry";

export const LOCALE_COOKIE = "warpdrive_locale";
export const CALENDAR_COOKIE = "warpdrive_calendar";
export const TIME_ZONE_COOKIE = "warpdrive_timezone";
export const COUNTRY_COOKIE = "warpdrive_country";
export const TIME_ZONE_MODE_COOKIE = "warpdrive_timezone_mode";
export const IRANIAN_MONEY_UNIT_COOKIE = "warpdrive_iranian_money_unit";
export const NUMBERING_SYSTEM_COOKIE = "warpdrive_numbering_system";
export const PREFERENCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export type CalendarSystem = "gregory" | "persian";
export type LocalePreferences = {
  locale: Locale;
  calendar: CalendarSystem;
  timeZone: string;
  country?: string;
  timeZoneMode?: "browser" | "manual";
  numberingSystem?: NumberingSystem;
  iranianMoneyUnit?: IranianMoneyUnit;
};

export function isTimeZone(value: string): boolean {
  // Date formatting and database civil-period queries must share a named zone.
  // Bare UTC offsets can use a different sign convention in PostgreSQL text queries.
  if (!/^[A-Za-z]/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const localePreferencesSchema = z.object({
  locale: z.enum(SELECTABLE_LOCALES),
  calendar: z.enum(["gregory", "persian"]),
  timeZone: z.string().min(1).max(100).refine(isTimeZone, "Invalid IANA time zone"),
  country: z.string().refine(isRegionalCountry, "Invalid country").optional(),
  timeZoneMode: z.enum(["browser", "manual"]).optional(),
  numberingSystem: z.enum(NUMBERING_SYSTEMS).optional(),
  iranianMoneyUnit: z.enum(["rial", "toman"]).optional(),
});

// Read cookies independently so one obsolete value cannot reset valid unrelated preferences.
export function resolveLocalePreferences(raw: {
  locale?: string | undefined;
  calendar?: string | undefined;
  timeZone?: string | undefined;
  country?: string | undefined;
  timeZoneMode?: string | undefined;
  numberingSystem?: string | undefined;
  iranianMoneyUnit?: string | undefined;
}): LocalePreferences {
  const locale = parseLocale(raw.locale);
  const country = isRegionalCountry(raw.country) ? raw.country : undefined;
  const regionalDefaults =
    country === undefined ? undefined : regionalFormatDefaults(country, locale);
  const calendar =
    raw.calendar === "gregory" || raw.calendar === "persian"
      ? raw.calendar
      : (regionalDefaults?.calendar ?? LOCALE_REGISTRY[locale].defaultCalendar);
  // Never infer a browser zone during render: SSR and hydration must see the same date.
  const timeZone = raw.timeZone !== undefined && isTimeZone(raw.timeZone) ? raw.timeZone : "UTC";
  const numberingSystem =
    raw.numberingSystem === "latn" || raw.numberingSystem === "arabext"
      ? raw.numberingSystem
      : regionalDefaults?.numberingSystem;
  return {
    locale,
    calendar,
    timeZone,
    ...(country === undefined ? {} : { country }),
    ...(raw.timeZoneMode === "browser" || raw.timeZoneMode === "manual"
      ? { timeZoneMode: raw.timeZoneMode }
      : {}),
    ...(raw.iranianMoneyUnit === "rial" || raw.iranianMoneyUnit === "toman"
      ? { iranianMoneyUnit: raw.iranianMoneyUnit }
      : {}),
    ...(numberingSystem === undefined ? {} : { numberingSystem }),
  };
}
