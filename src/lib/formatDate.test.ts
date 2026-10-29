import { describe, expect, it } from "vitest";
import { formatMediumDate } from "./formatDate";

describe("formatMediumDate", () => {
  it("formats a YYYY-MM-DD date as 'Mon D, YYYY'", () => {
    expect(formatMediumDate("2026-07-16")).toBe("Jul 16, 2026");
  });

  it("returns the raw string when it is not a parseable date", () => {
    expect(formatMediumDate("not-a-date")).toBe("not-a-date");
  });

  it("uses the selected locale and calendar for Iranian close dates", () => {
    expect(formatMediumDate("2026-03-21", { locale: "fa", calendar: "persian" })).toBe(
      "۱ فروردین ۱۴۰۵",
    );
    expect(formatMediumDate("2026-03-21", { locale: "de" })).toBe("21. März 2026");
  });

  it("does not silently roll invalid dates into another month", () => {
    expect(formatMediumDate("2026-02-30")).toBe("2026-02-30");
  });
});
