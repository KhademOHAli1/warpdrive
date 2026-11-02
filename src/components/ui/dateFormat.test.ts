import { describe, expect, it } from "vitest";
import {
  formatGregorianPersianDate,
  formatMdy,
  formatPersianAccessibleDate,
  formatPersianDate,
  parseYmd,
  toYmd,
} from "./dateFormat";

describe("dateFormat", () => {
  it("toYmd renders a local YYYY-MM-DD", () => {
    expect(toYmd(new Date(2026, 6, 4))).toBe("2026-07-04");
  });
  it("parseYmd returns a Date for a valid value and null otherwise", () => {
    expect(parseYmd("2026-07-04")?.getFullYear()).toBe(2026);
    expect(parseYmd("")).toBeNull();
    expect(parseYmd("not-a-date")).toBeNull();
  });
  it("parseYmd rejects out-of-range calendar parts instead of rolling over", () => {
    expect(parseYmd("2026-02-30")).toBeNull();
    expect(parseYmd("2026-13-01")).toBeNull();
    expect(parseYmd("2026-00-10")).toBeNull();
    expect(parseYmd("2026-02-28")?.getDate()).toBe(28);
    expect(parseYmd("2026-12-31")?.getMonth()).toBe(11);
  });
  it("formatMdy converts to MM/DD/YYYY and blanks invalid input", () => {
    expect(formatMdy("2026-07-04")).toBe("07/04/2026");
    expect(formatMdy("")).toBe("");
  });
  it("formats Solar Hijri dates at Nowruz and the end of a leap year", () => {
    expect(formatPersianDate("2024-03-20")).toBe("۱۴۰۳/۰۱/۰۱");
    expect(formatPersianDate("2025-03-20")).toBe("۱۴۰۳/۱۲/۳۰");
    expect(formatPersianDate("2025-03-21")).toBe("۱۴۰۴/۰۱/۰۱");
    expect(formatPersianDate("2026-02-30")).toBe("");
    expect(formatPersianDate("2026-03-21", "en")).toBe("1405/01/01");
    expect(formatGregorianPersianDate("2026-03-21")).toBe("۲۰۲۶/۰۳/۲۱");
  });
  it("uses natural Persian date labels and includes selection and today status", () => {
    expect(
      formatPersianAccessibleDate(new Date(2026, 9, 23), "persian", {
        today: true,
        selected: true,
      }),
    ).toBe("امروز، جمعه، ۱ آبان ۱۴۰۵، انتخاب‌شده");
  });

  it.each([
    { numberingSystem: "arabext", expected: "۱۴۰۵/۰۱/۰۱" },
    { numberingSystem: "latn", expected: "1405/01/01" },
  ] as const)(
    "honors explicit $numberingSystem in the English Iranian trigger",
    ({ numberingSystem, expected }) => {
      expect(formatPersianDate("2026-03-21", "en", numberingSystem)).toBe(expected);
    },
  );
});
