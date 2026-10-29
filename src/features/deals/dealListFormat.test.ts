import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateOnly } from "./dealListFormat";

describe("deal list date formatting", () => {
  it("uses an explicit locale and time zone for activity instants", () => {
    expect(fmtDate("2026-03-20T22:00:00Z")).toBe("Mar 20, 2026");
    expect(fmtDate("2026-03-20T22:00:00Z", { locale: "fa", timeZone: "Asia/Tehran" })).toBe(
      "۱ فروردین ۱۴۰۵",
    );
  });

  it("preserves civil dates across viewer zones and rejects invalid dates", () => {
    expect(fmtDateOnly("2026-03-21", { locale: "fa", timeZone: "America/Los_Angeles" })).toBe(
      "۱ فروردین ۱۴۰۵",
    );
    expect(fmtDateOnly("2026-02-30")).toBe("");
    expect(fmtDateOnly(null)).toBe("");
    expect(fmtDate("invalid")).toBe("");
  });
});
