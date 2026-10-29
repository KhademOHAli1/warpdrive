import { describe, expect, it } from "vitest";
import { calendarDayLabel, calendarHourLabel } from "./calendarLabels";

describe("localized calendar labels", () => {
  it("uses natural Persian spoken date order and Persian hour digits", () => {
    expect(calendarDayLabel("2026-03-21", { locale: "fa", calendar: "persian" })).toBe(
      "شنبه، ۱ فروردین ۱۴۰۵",
    );
    expect(calendarHourLabel(8, { locale: "fa" })).toBe("۰۸:۰۰");
  });
});
