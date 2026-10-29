import { describe, expect, it } from "vitest";
import { type DateFilterContext, resolveDatePresetRange } from "./datePresetRange";

const iran = { calendar: "persian" as const, locale: "fa" as const, timeZone: "Asia/Tehran" };
const range = (
  preset: Parameters<typeof resolveDatePresetRange>[0],
  iso: string,
  options: DateFilterContext = {},
) => resolveDatePresetRange(preset, { ...iran, ...options, now: new Date(iso) });

describe("relative date ranges use the viewer's civil date and selected calendar", () => {
  it("crosses Nowruz at Tehran midnight rather than UTC midnight", () => {
    expect(range("today", "2026-03-20T20:29:59Z")).toEqual({
      startDate: "2026-03-20",
      endDateExclusive: "2026-03-21",
    });
    expect(range("today", "2026-03-20T20:30:00Z")).toEqual({
      startDate: "2026-03-21",
      endDateExclusive: "2026-03-22",
    });
    expect(range("this_month", "2026-03-20T20:29:59Z")).toEqual({
      startDate: "2026-02-20",
      endDateExclusive: "2026-03-21",
    });
    expect(range("this_month", "2026-03-20T20:30:00Z")).toEqual({
      startDate: "2026-03-21",
      endDateExclusive: "2026-04-21",
    });
  });
  it("keeps leap Esfand's thirtieth day and crosses the Solar Hijri year", () => {
    expect(range("this_month", "2025-03-20T12:00:00Z")).toEqual({
      startDate: "2025-02-19",
      endDateExclusive: "2025-03-21",
    });
    expect(range("last_month", "2025-03-21T12:00:00Z")).toEqual({
      startDate: "2025-02-19",
      endDateExclusive: "2025-03-21",
    });
    expect(range("next_month", "2025-03-20T12:00:00Z")).toEqual({
      startDate: "2025-03-21",
      endDateExclusive: "2025-04-21",
    });
  });
  it("chooses months independently from the interface language", () => {
    expect(range("this_month", "2026-03-22T12:00:00Z", { calendar: "gregory" })).toEqual({
      startDate: "2026-03-01",
      endDateExclusive: "2026-04-01",
    });
    expect(range("this_month", "2026-03-22T12:00:00Z", { locale: "en" })).toEqual({
      startDate: "2026-03-21",
      endDateExclusive: "2026-04-21",
    });
  });
  it("shares the UI Saturday rule for Farsi or Persian calendars and Monday for English Gregorian", () => {
    expect(range("this_week", "2026-03-22T12:00:00Z")).toEqual({
      startDate: "2026-03-21",
      endDateExclusive: "2026-03-28",
    });
    expect(
      range("this_week", "2026-03-22T12:00:00Z", { locale: "en", calendar: "gregory" }),
    ).toEqual({
      startDate: "2026-03-16",
      endDateExclusive: "2026-03-23",
    });
    expect(
      range("this_week", "2026-03-22T12:00:00Z", { locale: "en", calendar: "persian" }),
    ).toEqual({ startDate: "2026-03-21", endDateExclusive: "2026-03-28" });
    expect(range("last_week", "2026-03-22T12:00:00Z")).toEqual({
      startDate: "2026-03-14",
      endDateExclusive: "2026-03-21",
    });
    expect(range("next_week", "2026-03-22T12:00:00Z")).toEqual({
      startDate: "2026-03-28",
      endDateExclusive: "2026-04-04",
    });
  });
  it("preserves Gregorian leap months, rolling windows and UTC defaults", () => {
    expect(range("this_month", "2024-02-29T12:00:00Z", { calendar: "gregory" })).toEqual({
      startDate: "2024-02-01",
      endDateExclusive: "2024-03-01",
    });
    expect(range("last_month", "2024-03-31T12:00:00Z", { calendar: "gregory" })).toEqual({
      startDate: "2024-02-01",
      endDateExclusive: "2024-03-01",
    });
    expect(range("last_7_days", "2026-03-21T12:00:00Z")).toEqual({
      startDate: "2026-03-15",
      endDateExclusive: "2026-03-22",
    });
    expect(range("next_30_days", "2026-03-21T12:00:00Z")).toEqual({
      startDate: "2026-03-21",
      endDateExclusive: "2026-04-20",
    });
    expect(
      resolveDatePresetRange("today", {
        now: new Date("2026-03-20T21:00:00Z"),
        timeZone: "invalid/zone",
      }),
    ).toEqual({ startDate: "2026-03-20", endDateExclusive: "2026-03-21" });
  });
  it.each([
    ["yesterday", "2026-03-20", "2026-03-21"],
    ["tomorrow", "2026-03-22", "2026-03-23"],
    ["next_7_days", "2026-03-21", "2026-03-28"],
    ["last_30_days", "2026-02-20", "2026-03-22"],
  ] as const)("preserves the civil-day window for %s", (preset, startDate, endDateExclusive) => {
    expect(range(preset, "2026-03-21T12:00:00Z")).toEqual({ startDate, endDateExclusive });
  });
  it("rejects an invalid injected clock", () => {
    expect(() => resolveDatePresetRange("today", { now: new Date("invalid") })).toThrow();
  });
});
