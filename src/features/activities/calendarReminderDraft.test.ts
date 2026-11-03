import { describe, expect, it } from "vitest";
import { calendarEventDraft } from "./calendarEventDraft";
import { mergeCalendarRefresh, reminderForEventKind } from "./calendarReminderDraft";

describe("native Calendar reminder form state", () => {
  it("does not enable a reminder by changing event kind", () => {
    expect(reminderForEventKind(null, true)).toBeNull();
    expect(reminderForEventKind({ kind: "none" }, true)).toEqual({ kind: "none" });
  });
  it("uses the explicitly retained all-day clock after changing back from timed", () => {
    const timed = reminderForEventKind(
      { kind: "all_day_at", channel: "in_app", localTime: "11:45" },
      false,
    );
    expect(timed).toEqual({ kind: "before_start", channel: "in_app", leadMinutes: 10 });
    expect(reminderForEventKind(timed, true, "11:45")).toEqual({
      kind: "all_day_at",
      channel: "in_app",
      localTime: "11:45",
    });
  });
  it("takes refreshed untouched times and preserves entered title and notes", () => {
    const initial = calendarEventDraft({ date: "2027-03-21", time: "09:00", timeZone: "UTC" });
    const refreshed = {
      ...initial,
      startTime: "11:00",
      endTime: "12:00",
      note: "From another editor",
    };
    const draft = { ...initial, subject: "My draft", note: "My unsaved note" };
    expect(mergeCalendarRefresh(draft, initial, refreshed)).toMatchObject({
      subject: "My draft",
      note: "My unsaved note",
      startTime: "11:00",
      endTime: "12:00",
    });
  });
});
