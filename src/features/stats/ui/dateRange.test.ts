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
  it("uses Gregorian month arithmetic without changing the chosen display calendar", () => {
    expect(presetRange("month", "2026-03-21")).toEqual({ from: "2026-03-01", to: "2026-03-21" });
  });
});
