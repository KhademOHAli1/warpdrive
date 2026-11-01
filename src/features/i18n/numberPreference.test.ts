import { expect, it } from "vitest";
import { formatTimeInput } from "@/components/ui/timeFormat";
import { formatCalendarDate } from "@/features/activities/calendarSystem";
import { monthTitle } from "@/features/activities/calendarView";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatDateOnly, formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { createAppTranslator } from "./catalog";
import { localePreferencesSchema, resolveLocalePreferences } from "./preferences";

it.each(["fa", "de", "en"] as const)(
  "keeps a validated %s digit choice in saved and cookie preferences",
  (locale) => {
    const preferences = {
      locale,
      calendar: "persian",
      timeZone: "Asia/Tehran",
      numberingSystem: "latn",
    } as const;
    expect(localePreferencesSchema.parse(preferences)).toEqual(preferences);
    expect(resolveLocalePreferences(preferences)).toEqual(preferences);
    expect(
      localePreferencesSchema.safeParse({ ...preferences, numberingSystem: "invalid" }).success,
    ).toBe(false);
  },
);

it("formats English digits in Farsi numbers, currencies, dates and ICU counts", () => {
  const preferences = {
    locale: "fa",
    calendar: "persian",
    timeZone: "UTC",
    numberingSystem: "latn",
  } as const;
  expect(formatNumber(1234.5, preferences)).toBe("1,234.5");
  expect(formatCurrency(1234.5, "EUR", preferences)).toContain("1,234.5");
  expect(formatDateOnly("2026-03-21", preferences)).toContain("1405");
  expect(
    formatCalendarDate(new Date("2026-03-21T00:00:00Z"), preferences, { year: "numeric" }),
  ).toContain("1405");
  expect(
    createAppTranslator("fa", "preferences", "latn")("numberPreview", { value: 12345 }),
  ).toContain("12,345");
});

it("uses language defaults only when no numbering choice is stored", () => {
  expect(formatNumber(1234, { locale: "fa" })).toBe("۱٬۲۳۴");
  expect(formatNumber(1234, { locale: "en" })).toBe("1,234");
  expect(formatNumber(1234, { locale: "de" })).toBe("1.234");
  for (const locale of ["fa", "de", "en"] as const) {
    expect(resolveLocalePreferences({ locale })).not.toHaveProperty("numberingSystem");
  }
});

it.each([
  { locale: "de", calendar: "persian", year: "۱۴۰۵", preview: "Vorschau:" },
  { locale: "en", calendar: "gregory", year: "۲۰۲۶", preview: "Preview:" },
] as const)(
  "honors explicit Persian digits in $locale without changing calendar or zone",
  ({ locale, calendar, year, preview }) => {
    const preferences = { locale, calendar, timeZone: "UTC", numberingSystem: "arabext" } as const;
    expect(localePreferencesSchema.parse(preferences)).toEqual(preferences);
    expect(resolveLocalePreferences(preferences)).toEqual(preferences);
    expect(formatNumber(12345, preferences, { useGrouping: false })).toBe("۱۲۳۴۵");
    const money = formatCurrency("1234.5", "EUR", preferences);
    expect(money).toContain("€");
    expect(money).toMatch(/[۰-۹]/);
    expect(money).not.toMatch(/[0-9]/);
    const count = createAppTranslator(
      locale,
      "preferences",
      "arabext",
    )("numberPreview", { value: 12345 });
    expect(count).toContain(preview);
    expect(count).toMatch(/[۰-۹]/);
    expect(count).not.toMatch(/[0-9]/);
    const civil = formatDateOnly("2026-03-21", preferences);
    expect(civil).toContain(year);
    expect(civil).not.toMatch(/[0-9]/);
    expect(formatDateOnly("2026-03-21", { ...preferences, timeZone: "Asia/Tehran" })).toBe(civil);
    const clock = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
    expect(formatDateTime("2026-03-20T22:00:00Z", preferences, clock)).toContain("۲۲:۰۰");
    expect(
      formatDateTime("2026-03-20T22:00:00Z", { ...preferences, timeZone: "Asia/Tehran" }, clock),
    ).toContain("۰۱:۳۰");
    expect(formatTimeInput("09:30", locale, "arabext")).toBe("۰۹:۳۰");
    expect(formatTimeInput("09:30", locale, "latn")).toBe("09:30");
  },
);

it("uses the chosen digits in time inputs and calendar month headings", () => {
  expect(formatTimeInput("09:30", "fa", "latn")).toBe("09:30");
  expect(
    monthTitle("2026-03-21", { locale: "fa", calendar: "persian", numberingSystem: "latn" }),
  ).toBe("فروردین 1405");
});
