import { describe, expect, it } from "vitest";
import {
  calendarEventDraft,
  calendarEventIssue,
  calendarEventPatch,
  moveCalendarStart,
} from "./calendarEventDraft";
import type { EditableActivity } from "./getForEdit";

const stored: EditableActivity = {
  id: "00000000-0000-4000-8000-000000000001",
  typeId: "00000000-0000-4000-8000-000000000002",
  subject: "جلسهٔ برنامه‌ریزی",
  priority: null,
  dueAt: "2026-10-25T01:30:29.123Z",
  endAt: null,
  durationMinutes: 60,
  allDay: false,
  dueDate: null,
  endDate: null,
  location: "Berlin",
  note: "<p>Besprechung</p>",
  videoCallUrl: "https://meet.google.com/abc-defg-hij",
  assigneeId: "00000000-0000-4000-8000-000000000003",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  guestPersonIds: ["00000000-0000-4000-8000-000000000004"],
  participantUserIds: [],
  dealTitle: null,
  personName: null,
  orgName: null,
};

describe("calendar event drafts", () => {
  it("seeds a timed slot with an explicit one-hour end across midnight", () => {
    const d = calendarEventDraft({ date: "2027-03-20", time: "23:30", timeZone: "Asia/Tehran" });
    expect(d).toMatchObject({
      startDate: "2027-03-20",
      startTime: "23:30",
      endDate: "2027-03-21",
      endTime: "00:30",
    });
  });

  it("uses civil dates for an all-day event, including Nowruz", () => {
    const d = calendarEventDraft({ date: "2027-03-21", time: "", timeZone: "Asia/Tehran" });
    expect(d).toMatchObject({
      startDate: "2027-03-21",
      endDate: "2027-03-21",
      startTime: "",
      endTime: "",
    });
  });

  it("reopens a same-day duration and preserves notes, guests and meeting URL", () => {
    const d = calendarEventDraft({ editing: stored, timeZone: "Europe/Berlin" });
    expect(d).toMatchObject({
      startTime: "02:30",
      endTime: "03:30",
      note: stored.note,
      participants: stored.guestPersonIds,
      videoCallUrl: stored.videoCallUrl,
    });
  });

  it("an untouched save keeps exact seconds and the later DST occurrence", () => {
    const d = calendarEventDraft({ editing: stored, timeZone: "Europe/Berlin" });
    expect(calendarEventPatch(stored, d, "Europe/Berlin")).toBeNull();
    d.subject = "Termin mit dem Team";
    expect(calendarEventPatch(stored, d, "Europe/Berlin")).toEqual({
      id: stored.id,
      subject: "Termin mit dem Team",
    });
  });

  it("does not overwrite hidden CRM associations or participants on a location edit", () => {
    const d = calendarEventDraft({ editing: stored, timeZone: "Europe/Berlin" });
    d.location = "  تهران  ";
    expect(calendarEventPatch(stored, d, "Europe/Berlin")).toEqual({
      id: stored.id,
      location: "تهران",
    });
  });

  it("an end-only edit preserves the exact start and later DST occurrence", () => {
    const d = calendarEventDraft({ editing: stored, timeZone: "Europe/Berlin" });
    d.endTime = "03:45";
    expect(calendarEventPatch(stored, d, "Europe/Berlin")).toEqual({
      id: stored.id,
      endAt: "2026-10-25T02:45:00.000Z",
      endDate: null,
      durationMinutes: 75,
    });
  });

  it("rejects an earlier repeated-hour end relative to the stored start instant", () => {
    const d = calendarEventDraft({ editing: stored, timeZone: "Europe/Berlin" });
    d.endTime = "02:45";
    expect(calendarEventIssue(d, "Europe/Berlin", stored)).toBe("endBeforeStart");
  });

  it("moving a stored event uses its actual duration across a repeated hour", () => {
    const d = calendarEventDraft({ editing: stored, timeZone: "Europe/Berlin" });
    expect(
      moveCalendarStart(d, { date: "2026-10-26", time: "02:30" }, "Europe/Berlin", stored),
    ).toMatchObject({
      startDate: "2026-10-26",
      startTime: "02:30",
      endDate: "2026-10-26",
      endTime: "03:30",
    });
  });

  it("preserves elapsed duration when the start crosses a DST transition", () => {
    const d = calendarEventDraft({ date: "2027-03-27", time: "01:30", timeZone: "Europe/Berlin" });
    const moved = moveCalendarStart(d, { date: "2027-03-28", time: "01:30" }, "Europe/Berlin");
    expect(moved).toMatchObject({
      startDate: "2027-03-28",
      startTime: "01:30",
      endDate: "2027-03-28",
      endTime: "03:30",
    });
  });

  it("keeps the inclusive civil-day span when moving an all-day event", () => {
    const d = calendarEventDraft({ date: "2027-03-20", time: "", timeZone: "Asia/Tehran" });
    d.endDate = "2027-03-22";
    expect(moveCalendarStart(d, { date: "2027-03-21", time: "" }, "Asia/Tehran").endDate).toBe(
      "2027-03-23",
    );
  });

  it.each([
    [{ startDate: "2027-02-30" }, "invalidDate"],
    [{ startTime: "99:00" }, "invalidTime"],
    [{ startDate: "2027-03-28", startTime: "02:30" }, "invalidWallTime"],
    [{ endTime: "08:00" }, "endBeforeStart"],
    [{ videoCallUrl: "javascript:alert(1)" }, "invalidMeetingUrl"],
    [{ videoCallUrl: "http://example.com/meeting" }, "invalidMeetingUrl"],
  ])("blocks invalid schedule or meeting input: %j", (patch, issue) => {
    const d = calendarEventDraft({ date: "2027-03-28", time: "09:00", timeZone: "Europe/Berlin" });
    d.typeId = stored.typeId;
    d.subject = "جلسه";
    Object.assign(d, patch);
    expect(calendarEventIssue(d, "Europe/Berlin")).toBe(issue);
  });
});
