import { describe, expect, it } from "vitest";
import { presetRange } from "./dateRange";

describe("performance civil-date presets", () => {
  it("includes today and exactly 29 preceding dates across a year boundary", () => {
    expect(presetRange("last30", "2026-01-10")).toEqual({ from: "2025-12-12", to: "2026-01-10" });
  });
  it("retains leap day when crossing February", () => {
    expect(presetRange("last30", "2028-03-01")).toEqual({ from: "2028-02-01", to: "2028-03-01" });
  });
  it.each([
    ["2026-01-01", "2026-01-01"],
    ["2026-03-31", "2026-01-01"],
    ["2026-04-01", "2026-04-01"],
    ["2026-09-30", "2026-07-01"],
    ["2026-12-31", "2026-10-01"],
  ])("uses the quarter containing the viewer's date %s", (today, from) => {
    expect(presetRange("quarter", today)).toEqual({ from, to: today });
  });
  it("uses the server's reporting year even when the browser clock differs", () => {
    expect(presetRange("year", "2027-01-01")).toEqual({ from: "2027-01-01", to: "2027-01-01" });
  });
  it("preserves the Gregorian default for existing callers", () => {
    expect(presetRange("month", "2026-03-21")).toEqual({ from: "2026-03-01", to: "2026-03-21" });
  });

  it.each(["month", "quarter", "year"] as const)(
    "starts a Persian %s preset at Nowruz on the first day of the year",
    (preset) => {
      expect(presetRange(preset, "2026-03-21", "persian")).toEqual({
        from: "2026-03-21",
        to: "2026-03-21",
      });
    },
  );

  it.each([
    ["2025-03-20", "2025-02-19", "2024-12-21", "2024-03-20"],
    ["2026-03-20", "2026-02-20", "2025-12-22", "2025-03-21"],
  ])(
    "keeps the final day of leap or ordinary Esfand in its real Persian periods: %s",
    (today, month, quarter, year) => {
      expect(presetRange("month", today, "persian")).toEqual({ from: month, to: today });
      expect(presetRange("quarter", today, "persian")).toEqual({ from: quarter, to: today });
      expect(presetRange("year", today, "persian")).toEqual({ from: year, to: today });
    },
  );

  it.each([
    ["2026-06-21", "2026-03-21"],
    ["2026-06-22", "2026-06-22"],
    ["2026-09-22", "2026-06-22"],
    ["2026-09-23", "2026-09-23"],
    ["2026-12-21", "2026-09-23"],
    ["2026-12-22", "2026-12-22"],
    ["2027-01-01", "2026-12-22"],
  ])("uses Persian quarter boundaries for %s", (today, from) => {
    expect(presetRange("quarter", today, "persian")).toEqual({ from, to: today });
  });

  it("keeps the same ISO storage and today while the calendar changes the period start", () => {
    expect(presetRange("year", "2026-11-05", "gregory")).toEqual({
      from: "2026-01-01",
      to: "2026-11-05",
    });
    expect(presetRange("year", "2026-11-05", "persian")).toEqual({
      from: "2026-03-21",
      to: "2026-11-05",
    });
  });

  it.each(["gregory", "persian"] as const)(
    "keeps last30 as 30 inclusive civil dates across Nowruz with the %s calendar",
    (calendar) => {
      expect(presetRange("last30", "2026-03-21", calendar)).toEqual({
        from: "2026-02-20",
        to: "2026-03-21",
      });
    },
  );
});
