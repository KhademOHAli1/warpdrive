import { describe, expect, it } from "vitest";
import { type BookingCalendarEvent, renderBookingCalendar } from "./calendar";

const event: BookingCalendarEvent = {
  id: "d584d5ed-dd26-4f71-b318-dff5f7bea6a5",
  startsAt: "2026-10-25T02:10:00+02:00",
  endsAt: "2026-10-25T02:10:00+01:00",
  updatedAt: "2026-10-23T12:44:04.927Z",
  version: 2,
};

const unfold = (value: string) => value.replace(/\r\n[ \t]/gu, "");

describe("equipment booking iCalendar exports", () => {
  it("preserves both DST occurrences and supplies stable UTC revisions to a subscriber", () => {
    const confirmed = renderBookingCalendar([event]);
    const cancelled = renderBookingCalendar([{ ...event, version: 3, status: "cancelled" }]);
    expect(confirmed).toContain("DTSTART:20261025T001000Z\r\nDTEND:20261025T011000Z\r\n");
    expect(confirmed).toContain("DTSTAMP:20261023T124404Z\r\n");
    expect(confirmed).toContain("SEQUENCE:2\r\nSTATUS:CONFIRMED\r\n");
    expect(cancelled).toContain("SEQUENCE:3\r\nSTATUS:CANCELLED\r\n");
    expect(confirmed).toContain(`UID:${event.id}@booking.warpdrive.invalid\r\n`);
    expect(cancelled).toContain(`UID:${event.id}@booking.warpdrive.invalid\r\n`);
    expect(confirmed).toMatch(/^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:/u);
    expect(confirmed.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes text and excludes details outside the authorized event projection", () => {
    const record = {
      ...event,
      summary: "Check: gauge, cable; path\\parts\r\nATTENDEE:injected@example.invalid",
      description: "private requester note",
      credential: "site-only calendar secret",
    };
    const result = unfold(renderBookingCalendar([record]));
    expect(result).toContain(
      "SUMMARY:Check: gauge\\, cable\\; path\\\\parts\\nATTENDEE:injected@example.invalid\r\n",
    );
    expect(result).not.toContain("\r\nATTENDEE:");
    expect(result).not.toContain(record.description);
    expect(result).not.toContain(record.credential);
    expect(renderBookingCalendar([event])).toContain("SUMMARY:Equipment booking\r\n");
  });

  it("folds long text by UTF-8 octet and preserves every Unicode code point", () => {
    const summary = "اندازه‌گیری کابل 🔬 Straße ".repeat(12).trim();
    const result = renderBookingCalendar([{ ...event, summary, status: "tentative" }]);
    const lines = result.split("\r\n");
    expect(lines.some((line) => line.startsWith(" "))).toBe(true);
    for (const line of lines)
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    expect(unfold(result)).toContain(`SUMMARY:${summary}\r\n`);
    expect(result).toContain("STATUS:TENTATIVE\r\n");
    expect(result.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/u);
  });

  it("emits an empty free/busy component for a site with no reservations", () => {
    const result = renderBookingCalendar([]);
    expect(result).toContain("BEGIN:VFREEBUSY\r\n");
    expect(result).not.toContain("\r\nFREEBUSY:");
    expect(result).not.toContain("BEGIN:VEVENT");
  });

  it("rejects invalid projected values instead of writing ambiguous events", () => {
    expect(() => renderBookingCalendar([{ ...event, startsAt: "2026-10-25T02:10:00" }])).toThrow();
    expect(() => renderBookingCalendar([{ ...event, endsAt: event.startsAt }])).toThrow();
    expect(() => renderBookingCalendar([{ ...event, version: -1 }])).toThrow();
    expect(() => renderBookingCalendar([{ ...event, id: "calendar-token-or-path" }])).toThrow();
    expect(() =>
      renderBookingCalendar([event, { ...event, id: event.id.toUpperCase() }]),
    ).toThrow();
  });
});
