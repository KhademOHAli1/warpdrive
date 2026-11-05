import { describe, expect, it } from "vitest";
import type { CalendarActivity } from "./calendar";
import {
  type CalendarPoint,
  calendarMoveTarget,
  calendarSelection,
  movePreviewSelection,
  selectionSegments,
  snapCalendarMinute,
} from "./calendarGesture";

function point(date: string, minute = 0, kind: CalendarPoint["kind"] = "time"): CalendarPoint {
  return { date, minute, kind };
}

function event(patch: Partial<CalendarActivity> = {}): CalendarActivity {
  return {
    id: "event",
    subject: "Meeting",
    dueAt: new Date("2026-11-05T09:07:00Z"),
    allDay: false,
    durationMinutes: 60,
    typeKey: "meeting",
    done: false,
    dealId: null,
    personId: null,
    orgId: null,
    overdue: false,
    ownerName: null,
    ...patch,
  };
}

describe("calendar gesture geometry", () => {
  it("snaps to quarter-hours and clamps to the final selectable slot", () => {
    expect(snapCalendarMinute(457, 1152)).toBe(570);
    expect(snapCalendarMinute(-1, 1152)).toBe(0);
    expect(snapCalendarMinute(1152, 1152)).toBe(1425);
    expect(snapCalendarMinute(2000, 1152)).toBe(1425);
    expect(snapCalendarMinute(5, 0)).toBe(0);
  });

  it("creates an ordered timed span in either drag direction", () => {
    const first = point("2026-11-05", 540);
    const last = point("2026-11-05", 585);
    const expected = { date: "2026-11-05", time: "09:00", endDate: "2026-11-05", endTime: "10:00" };
    expect(calendarSelection(first, last)).toEqual(expected);
    expect(calendarSelection(last, first)).toEqual(expected);
  });

  it("rolls the final quarter-hour to an exclusive next-day midnight", () => {
    expect(calendarSelection(point("2026-12-31", 1425), point("2026-12-31", 1425))).toEqual({
      date: "2026-12-31",
      time: "23:45",
      endDate: "2027-01-01",
      endTime: "00:00",
    });
  });

  it("creates inclusive all-day ranges across Nowruz independent of display direction", () => {
    expect(
      calendarSelection(point("2026-03-23", 0, "date"), point("2026-03-20", 0, "date")),
    ).toEqual({
      date: "2026-03-20",
      endDate: "2026-03-23",
    });
    expect(calendarSelection(point("2026-11-05"), point("2026-11-06", 0, "date"))).toBeNull();
    expect(calendarSelection(point("invalid"), point("2026-11-05"))).toBeNull();
  });
});

describe("calendar move targets", () => {
  it("preserves where within the event it was grabbed and its off-grid start minute", () => {
    expect(
      calendarMoveTarget(event(), point("2026-11-05", 555), point("2026-11-06", 600), "UTC"),
    ).toEqual({
      date: "2026-11-06",
      time: "09:52",
    });
  });

  it("moves a continuation cell by the grabbed date delta rather than replacing the start date", () => {
    const a = event({
      dueAt: new Date("2026-10-31T09:07:31.125Z"),
      endAt: new Date("2026-11-03T12:00:00Z"),
    });
    expect(
      calendarMoveTarget(a, point("2026-11-02", 0, "date"), point("2026-11-05", 0, "date"), "UTC"),
    ).toEqual({ date: "2026-11-03" });
  });

  it("keeps all-day events as inclusive civil-date spans", () => {
    const a = event({ allDay: true, dueDate: "2026-03-20", endDate: "2026-03-23" });
    const target = calendarMoveTarget(
      a,
      point("2026-03-22", 0, "date"),
      point("2026-03-25", 0, "date"),
      "Asia/Tehran",
    );
    expect(target).toEqual({ date: "2026-03-23" });
    expect(movePreviewSelection(a, { date: "2026-03-23" }, "Asia/Tehran")).toEqual({
      date: "2026-03-23",
      endDate: "2026-03-26",
    });
    expect(
      calendarMoveTarget(
        a,
        point("2026-03-22", 0, "date"),
        point("2026-03-25", 540),
        "Asia/Tehran",
      ),
    ).toBeNull();
  });

  it("rejects targets in a DST gap for time and date-only moves", () => {
    const a = event({ dueAt: new Date("2026-03-28T01:30:00Z") });
    expect(
      calendarMoveTarget(a, point("2026-03-28", 150), point("2026-03-29", 150), "Europe/Berlin"),
    ).toBeNull();
    expect(
      calendarMoveTarget(
        a,
        point("2026-03-28", 0, "date"),
        point("2026-03-29", 0, "date"),
        "Europe/Berlin",
      ),
    ).toBeNull();
    expect(
      movePreviewSelection(a, { date: "2026-03-29", time: "02:30" }, "Europe/Berlin"),
    ).toBeNull();
  });
});

describe("calendar gesture previews", () => {
  it("clips multi-day timed selections to each displayed day", () => {
    const range = { date: "2026-11-05", time: "23:30", endDate: "2026-11-06", endTime: "01:15" };
    expect(selectionSegments(range, "2026-11-05")).toEqual({ startMinute: 1410, endMinute: 1440 });
    expect(selectionSegments(range, "2026-11-06")).toEqual({ startMinute: 0, endMinute: 75 });
    expect(selectionSegments(range, "2026-11-07")).toBeNull();
    expect(selectionSegments({ date: "2026-11-05", endDate: "2026-11-06" }, "2026-11-06")).toEqual({
      startMinute: 0,
      endMinute: 1440,
    });
  });

  it("does not highlight the day after an exclusive midnight endpoint", () => {
    const range = { date: "2026-11-05", time: "23:45", endDate: "2026-11-06", endTime: "00:00" };
    expect(selectionSegments(range, "2026-11-06")).toBeNull();
  });

  it("renders the preserved elapsed duration through its actual wall-clock endpoints", () => {
    const a = event({
      dueAt: new Date("2026-03-28T00:30:00Z"),
      endAt: new Date("2026-03-28T01:30:00Z"),
    });
    const preview = movePreviewSelection(a, { date: "2026-03-29", time: "01:30" }, "Europe/Berlin");
    expect(preview).toEqual({
      date: "2026-03-29",
      time: "01:30",
      endDate: "2026-03-29",
      endTime: "03:30",
    });
    expect(preview === null ? null : selectionSegments(preview, "2026-03-29")).toEqual({
      startMinute: 90,
      endMinute: 210,
    });
  });

  it("retains an untouched repeated-hour instant and renders a positive fold preview", () => {
    const later = event({ dueAt: new Date("2026-10-25T01:30:00Z"), durationMinutes: 45 });
    expect(
      movePreviewSelection(later, { date: "2026-10-25", time: "02:30" }, "Europe/Berlin"),
    ).toEqual({
      date: "2026-10-25",
      time: "02:30",
      endDate: "2026-10-25",
      endTime: "03:15",
    });
    const earlier = event({ dueAt: new Date("2026-10-25T00:30:00Z"), durationMinutes: 60 });
    const preview = movePreviewSelection(
      earlier,
      { date: "2026-10-25", time: "02:30" },
      "Europe/Berlin",
    );
    expect(preview?.endTime).toBe("02:30");
    expect(preview === null ? null : selectionSegments(preview, "2026-10-25")).toEqual({
      startMinute: 150,
      endMinute: 210,
    });
  });

  it("gives point events a visible preview without changing their stored representation", () => {
    const a = event({ durationMinutes: null, endAt: null });
    expect(movePreviewSelection(a, { date: "2026-11-06", time: "10:00" }, "UTC")).toEqual({
      date: "2026-11-06",
      time: "10:00",
      endDate: "2026-11-06",
      endTime: "10:30",
    });
    expect(movePreviewSelection(a, { date: "2026-03-29", time: "01:45" }, "Europe/Berlin")).toEqual(
      {
        date: "2026-03-29",
        time: "01:45",
        endDate: "2026-03-29",
        endTime: "02:15",
      },
    );
    expect(a.durationMinutes).toBeNull();
    expect(a.endAt).toBeNull();
    expect(selectionSegments({ date: "invalid", endDate: "invalid" }, "2026-11-06")).toBeNull();
  });

  it("keeps seconds and milliseconds when previewing a date-only move", () => {
    const a = event({
      dueAt: new Date("2026-11-05T09:07:31.125Z"),
      endAt: new Date("2026-11-05T09:08:00.125Z"),
    });
    expect(movePreviewSelection(a, { date: "2026-11-06" }, "UTC")).toEqual({
      date: "2026-11-06",
      time: "09:07",
      endDate: "2026-11-06",
      endTime: "09:08",
    });
  });
});
