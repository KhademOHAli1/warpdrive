import { describe, expect, it } from "vitest";
import { DEFAULT_START_HOUR, initialScrollHour } from "./agendaScroll";
import type { CalendarActivity } from "./calendar";

function activity(over: Partial<CalendarActivity> & { id: string }): CalendarActivity {
  return {
    subject: over.id,
    dueAt: new Date("2026-08-24T09:00:00Z"),
    allDay: false,
    durationMinutes: 60,
    typeKey: "call",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    overdue: false,
    ownerName: null,
    ...over,
  };
}

describe("initialScrollHour", () => {
  it("opens on the working day rather than midnight when there is nothing earlier", () => {
    expect(initialScrollHour([])).toBe(DEFAULT_START_HOUR);
  });

  it("does not scroll past the working day just because the first activity is late", () => {
    const late = activity({ id: "a", dueAt: new Date("2026-08-24T15:00:00Z") });
    expect(initialScrollHour([late])).toBe(DEFAULT_START_HOUR);
  });

  it("opens earlier in the account zone when an activity would otherwise sit above the fold", () => {
    const early = activity({ id: "a", dueAt: new Date("2026-08-24T03:00:00Z") });
    const later = activity({ id: "b", dueAt: new Date("2026-08-24T07:30:00Z") });
    expect(initialScrollHour([early, later], "Asia/Tehran")).toBe(6);
  });

  it("ignores an all-day activity, which is stored at midnight and shown in its own lane", () => {
    const offsite = activity({ id: "a", allDay: true, dueAt: new Date("2026-08-24T00:00:00Z") });
    expect(initialScrollHour([offsite])).toBe(DEFAULT_START_HOUR);
  });
});
