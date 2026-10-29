import { expect, it } from "vitest";
import { formatTimeInput } from "@/components/ui/timeFormat";
import { formatCalendarDate } from "@/features/activities/calendarSystem";
import { monthTitle } from "@/features/activities/calendarView";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatDateOnly, formatNumber } from "@/lib/localeFormatting";
import { createAppTranslator } from "./catalog";
import { localePreferencesSchema, resolveLocalePreferences } from "./preferences";

it("keeps a validated Farsi digit choice in saved and cookie preferences", () => {
  const preferences = {
    locale: "fa",
    calendar: "persian",
    timeZone: "Asia/Tehran",
    numberingSystem: "latn",
  } as const;
  expect(localePreferencesSchema.parse(preferences)).toEqual(preferences);
  expect(resolveLocalePreferences(preferences)).toEqual(preferences);
  expect(
    localePreferencesSchema.safeParse({ ...preferences, numberingSystem: "invalid" }).success,
  ).toBe(false);
});

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

it("preserves Persian defaults and uses English digits outside Farsi", () => {
  expect(formatNumber(1234, { locale: "fa" })).toBe("۱٬۲۳۴");
  expect(formatNumber(1234, { locale: "en", numberingSystem: "arabext" })).toBe("1,234");
});

it("uses the chosen digits in time inputs and calendar month headings", () => {
  expect(formatTimeInput("09:30", "fa", "latn")).toBe("09:30");
  expect(
    monthTitle("2026-03-21", { locale: "fa", calendar: "persian", numberingSystem: "latn" }),
  ).toBe("فروردین 1405");
});
