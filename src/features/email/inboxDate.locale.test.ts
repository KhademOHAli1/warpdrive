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

describe("German mail dates", () => {
  const de = { locale: "de", calendar: "gregory", timeZone: "UTC" } as const;
  it("uses German relative text for reader and timeline dates", () => {
    const sent = "2026-03-21T12:00:00Z";
    expect(formatReaderDate(sent, new Date("2026-03-24T12:00:00Z"), de)).toContain("(vor 3 Tagen)");
    expect(formatTimelineEmailDate(sent, new Date("2026-03-21T12:12:00Z"), de)).toContain(
      "(vor 12 Minuten)",
    );
    expect(formatTimelineEmailDate(sent, new Date("2026-03-21T13:00:00Z"), de)).toContain(
      "(vor 1 Stunde)",
    );
  });
  it("still determines yesterday using the account timezone", () => {
    expect(
      formatReaderDate("2026-10-29T22:30:00Z", new Date("2026-10-30T00:30:00Z"), {
        ...de,
        timeZone: "Europe/Berlin",
      }),
    ).toContain("(gestern)");
  });
});
