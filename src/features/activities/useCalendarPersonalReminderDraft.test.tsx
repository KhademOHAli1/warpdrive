// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { EditableActivity } from "./getForEdit";
import { useCalendarPersonalReminderDraft } from "./useCalendarPersonalReminderDraft";

vi.mock("./reminderSettingsActions", () => ({ setEventReminderSettingsAction: vi.fn() }));
const calendar = {
  defaults: { timed: [{ method: "notification" as const, minutesBefore: 10 }], allDay: [] },
  revision: 1,
  emailCapability: "available" as const,
};
const editing: EditableActivity = {
  id: "event",
  typeId: "meeting",
  subject: "Review",
  priority: null,
  dueAt: "2027-03-21T08:00:00Z",
  endAt: null,
  durationMinutes: 60,
  allDay: false,
  dueDate: null,
  endDate: null,
  location: null,
  note: null,
  videoCallUrl: null,
  assigneeId: "owner",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  guestPersonIds: [],
  participantUserIds: [],
  dealTitle: null,
  personName: null,
  orgName: null,
  calendarId: "original",
  personalReminders: {
    selection: { useDefault: true },
    revision: 3,
    subscribed: true,
    defaults: { timed: [{ method: "notification", minutesBefore: 30 }], allDay: [] },
    emailCapability: "channelDisabled",
    timeZone: "Europe/Berlin",
  },
};
it("uses the freshly opened event's defaults instead of an older cached calendar list", () => {
  const { result } = renderHook(() => useCalendarPersonalReminderDraft(editing, calendar));
  expect(result.current.defaults.timed[0]?.minutesBefore).toBe(30);
  expect(result.current.emailCapability).toBe("channelDisabled");
});
it("uses the selected calendar's defaults when an event is moved", () => {
  const { result } = renderHook(() => useCalendarPersonalReminderDraft(editing, calendar, "other"));
  expect(result.current.defaults.timed[0]?.minutesBefore).toBe(10);
});
