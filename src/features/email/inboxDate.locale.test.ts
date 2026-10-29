import { describe, expect, it } from "vitest";
import { formatInboxListDate, formatReaderDate, formatTimelineEmailDate } from "./inboxDate";

const prefs = { locale: "fa", calendar: "persian", timeZone: "UTC" } as const;
describe("Persian mail dates", () => {
  it("compares Iranian calendar years when deciding whether to show the year", () => {
    expect(
      formatInboxListDate("2026-03-21T12:00:00Z", new Date("2026-03-20T12:00:00Z"), prefs),
    ).toContain("۱۴۰۵");
  });
  it("uses contextual Persian relative ages and digits", () => {
    expect(
      formatReaderDate("2026-03-21T12:00:00Z", new Date("2026-03-24T12:00:00Z"), prefs),
    ).toContain("۳ روز پیش");
    expect(
      formatTimelineEmailDate("2026-03-21T12:00:00Z", new Date("2026-03-21T12:12:00Z"), prefs),
    ).toContain("۱۲ دقیقه پیش");
  });
});
