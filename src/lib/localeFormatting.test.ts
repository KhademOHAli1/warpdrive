import { describe, expect, it } from "vitest";
import { formatDateOnly, formatDateTime, formatNumber } from "./localeFormatting";

describe("locale-aware formatting", () => {
  it("formats Iranian civil dates without shifting them into the viewer's time zone", () => {
    const preferences = {
      locale: "fa",
      calendar: "persian",
      timeZone: "America/Los_Angeles",
    } as const;
    expect(formatDateOnly("2026-03-21", preferences)).toBe("۱ فروردین ۱۴۰۵");
    expect(formatDateOnly("2026-03-21", { ...preferences, timeZone: "Asia/Tehran" })).toBe(
      "۱ فروردین ۱۴۰۵",
    );
  });

  it("keeps interface language independent of the calendar", () => {
    expect(formatDateOnly("2026-03-21", { locale: "fa", calendar: "gregory" })).toBe(
      "۲۱ مارس ۲۰۲۶",
    );
    expect(formatDateOnly("2026-03-21", { locale: "en", calendar: "persian" })).toContain(
      "Farvardin",
    );
  });

  it("formats instants in an explicitly selected time zone", () => {
    const options = { hour: "2-digit", minute: "2-digit", hour12: false } as const;
    expect(
      formatDateTime("2026-03-20T22:00:00Z", { locale: "en", timeZone: "Asia/Tehran" }, options),
    ).toBe("01:30");
    expect(formatDateTime("2026-03-20T22:00:00Z", { locale: "en", timeZone: "UTC" }, options)).toBe(
      "22:00",
    );
  });

  it("supports German locale rules without enabling German UI", () => {
    expect(formatDateOnly("2026-03-21", { locale: "de" })).toBe("21. März 2026");
    expect(formatNumber(1234.5, { locale: "de" })).toBe("1.234,5");
    expect(formatNumber(1234.5, { locale: "fa" })).toBe("۱٬۲۳۴٫۵");
  });

  it("rejects invalid civil dates and instants instead of rolling them over", () => {
    expect(formatDateOnly("2026-02-30")).toBe("");
    expect(formatDateOnly("2026-13-01")).toBe("");
    expect(formatDateTime("invalid")).toBe("");
  });
});
