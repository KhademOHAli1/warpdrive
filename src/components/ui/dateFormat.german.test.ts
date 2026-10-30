import { describe, expect, it } from "vitest";
import { formatDmy, formatGermanAccessibleDate, formatPersianDate } from "./dateFormat";

describe("German calendar date formatting", () => {
  it("displays Gregorian civil values as DD.MM.YYYY and rejects invalid dates", () => {
    expect(formatDmy("2026-07-04")).toBe("04.07.2026");
    expect(formatDmy("2026-02-30")).toBe("");
    expect(formatDmy("")).toBe("");
  });

  it("uses German numeric ordering for the chosen Iranian calendar at Nowruz and a leap boundary", () => {
    expect(formatPersianDate("2024-03-20", "de")).toBe("01.01.1403");
    expect(formatPersianDate("2025-03-20", "de")).toBe("30.12.1403");
    expect(formatPersianDate("2025-03-21", "de")).toBe("01.01.1404");
    expect(formatPersianDate("2026-03-21", "de")).toBe("01.01.1405");
    expect(formatPersianDate("2026-02-30", "de")).toBe("");
  });

  it("names German Gregorian and Iranian days, including today and selected status", () => {
    const date = new Date(2026, 2, 21);
    expect(formatGermanAccessibleDate(date, "gregory")).toBe("Samstag, 21. März 2026");
    expect(formatGermanAccessibleDate(date, "persian", { today: true, selected: true })).toBe(
      "Heute, Samstag, 1. Farwardin 1405, ausgewählt",
    );
  });
});
