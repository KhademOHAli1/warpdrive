import { describe, expect, it } from "vitest";
import type { CalendarActivity } from "./calendar";
import type { CalendarPoint } from "./calendarGesture";
import { calendarResizeTarget, snapCalendarResizeMinute } from "./calendarResize";

const day = "2026-11-05";

function activity(dueAt: string, endAt?: string, durationMinutes = 60): CalendarActivity {
  return {
    id: "activity",
    subject: "Review",
    dueAt: new Date(dueAt),
    endAt: endAt === undefined ? null : new Date(endAt),
    allDay: false,
    durationMinutes,
    typeKey: "meeting",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    ownerName: null,
    overdue: false,
  };
}

function point(minute: number, date = day): CalendarPoint {
  return { date, minute, kind: "time" };
}

describe("resize pointer geometry", () => {
  it("rounds to the nearest quarter and includes the midnight boundary", () => {
    expect(snapCalendarResizeMinute(7.4, 1440)).toBe(0);
    expect(snapCalendarResizeMinute(7.5, 1440)).toBe(15);
    expect(snapCalendarResizeMinute(1439, 1440)).toBe(1440);
  });

  it("applies the pointer's displacement to the end while retaining the start", () => {
    const event = activity(`${day}T09:07:22.500Z`, `${day}T10:07:22.500Z`);
    expect(calendarResizeTarget(event, "end", point(615), point(645), "UTC")).toMatchObject({
      target: { edge: "end", date: day, time: "10:30" },
      selection: { date: day, time: "09:07", endDate: day, endTime: "10:30" },
      changed: true,
    });
  });

  it("preserves the duration-derived end when resizing the start", () => {
    const event = activity(`${day}T09:07:22.500Z`);
    expect(calendarResizeTarget(event, "start", point(540), point(525), "UTC")).toMatchObject({
      target: { edge: "start", date: day, time: "08:45" },
      selection: { date: day, time: "08:45", endDate: day, endTime: "10:07" },
      changed: true,
    });
  });

  it("keeps an unmodified, off-grid endpoint unchanged", () => {
    const event = activity(`${day}T09:07:22.500Z`, `${day}T10:07:22.500Z`);
    expect(calendarResizeTarget(event, "start", point(540), point(540), "UTC")).toMatchObject({
      selection: { time: "09:07", endTime: "10:07" },
      changed: false,
    });
  });

  it("extends a point event from the visible half-hour grip", () => {
    const event = { ...activity(`${day}T09:00:00Z`), durationMinutes: null };
    expect(calendarResizeTarget(event, "end", point(570), point(585), "UTC")).toMatchObject({
      target: { edge: "end", date: day, time: "09:45" },
      selection: { time: "09:00", endTime: "09:45" },
      changed: true,
    });
    expect(calendarResizeTarget(event, "start", point(540), point(525), "UTC")).toBeNull();
  });

  it("represents 24:00 as midnight on the next civil day", () => {
    const event = activity(`${day}T22:00:00Z`, `${day}T23:45:00Z`, 105);
    expect(calendarResizeTarget(event, "end", point(1425), point(1440), "UTC")).toMatchObject({
      target: { edge: "end", date: "2026-11-06", time: "00:00" },
      selection: { date: day, time: "22:00", endDate: "2026-11-06", endTime: "00:00" },
    });
  });

  it("rejects an end at or before the exact untouched start", () => {
    const event = activity(`${day}T09:15:30Z`, `${day}T10:15:00Z`);
    expect(calendarResizeTarget(event, "end", point(615), point(555), "UTC")).toBeNull();
  });

  it("rejects skipped wall time instead of silently resizing to a different hour", () => {
    const spring = "2026-03-29";
    const event = activity(`${spring}T00:00:00Z`, `${spring}T01:15:00Z`, 75);
    expect(
      calendarResizeTarget(event, "end", point(195, spring), point(135, spring), "Europe/Berlin"),
    ).toBeNull();
  });

  it("keeps the later start occurrence during a daylight saving overlap", () => {
    const autumn = "2026-10-25";
    const event = activity(`${autumn}T01:30:00Z`, `${autumn}T02:30:00Z`);
    expect(
      calendarResizeTarget(event, "end", point(210, autumn), point(165, autumn), "Europe/Berlin"),
    ).toBeNull();
  });
});
