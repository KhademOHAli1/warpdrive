// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { CalendarActivity } from "@/features/activities/calendar";
import type { CalendarRescheduleValue } from "@/features/activities/calendarRescheduleSchemas";
import { useCalendarDisplayedEvents } from "./useCalendarDisplayedEvents";

afterEach(cleanup);

function event(id = "meeting"): CalendarActivity {
  return {
    id,
    subject: "Discuss the contract",
    dueAt: new Date("2026-11-05T08:00:29.123Z"),
    endAt: new Date("2026-11-05T09:00:29.123Z"),
    allDay: false,
    durationMinutes: 60,
    typeKey: "meeting",
    done: false,
    doneAt: null,
    dealId: "deal-1",
    dealTitle: "Original contract",
    personId: "person-1",
    orgId: "org-1",
    overdue: false,
    assigneeId: "owner-1",
    ownerName: "A colleague",
    note: "Keep the existing details",
    location: "Office",
  };
}

function moved(hour: number, id = "meeting"): CalendarRescheduleValue {
  return {
    id,
    dueAt: `2026-11-05T${String(hour).padStart(2, "0")}:00:29.123Z`,
    endAt: `2026-11-05T${String(hour + 1).padStart(2, "0")}:00:29.123Z`,
    allDay: false,
    dueDate: null,
    endDate: null,
    durationMinutes: 60,
  };
}

function serverEvent(
  source: CalendarActivity,
  schedule: CalendarRescheduleValue,
): CalendarActivity {
  return {
    ...source,
    ...schedule,
    dueAt: new Date(schedule.dueAt),
    endAt: schedule.endAt === null ? null : new Date(schedule.endAt),
  };
}

function renderDisplay(incoming: CalendarActivity[]) {
  return renderHook(({ events }) => useCalendarDisplayedEvents(events), {
    initialProps: { events: incoming },
  });
}

it("displays chained acknowledgments against the same original incoming list", () => {
  const incoming = [event()];
  const { result } = renderDisplay(incoming);
  act(() => result.current.confirm(moved(10)));
  expect(result.current.activities[0]!.dueAt.toISOString()).toBe(moved(10).dueAt);
  act(() => result.current.confirm(moved(12)));
  expect(result.current.activities[0]!.dueAt.toISOString()).toBe(moved(12).dueAt);
  expect(incoming[0]!.dueAt.toISOString()).toBe("2026-11-05T08:00:29.123Z");
});

it.each([10, 14])("retires the local overlay when server hour %s arrives", (serverHour) => {
  const original = [event()];
  const view = renderDisplay(original);
  act(() => view.result.current.confirm(moved(10)));
  const incoming = [serverEvent(original[0]!, moved(serverHour))];
  view.rerender({ events: incoming });
  expect(view.result.current.activities[0]).toBe(incoming[0]);
  expect(view.result.current.activities[0]!.dueAt.toISOString()).toBe(moved(serverHour).dueAt);
  // Returning even the identical old A list cannot revive the previous A -> B override.
  view.rerender({ events: original });
  expect(view.result.current.activities[0]).toBe(original[0]);
  expect(view.result.current.activities[0]!.dueAt.toISOString()).toBe("2026-11-05T08:00:29.123Z");
});

it("lets a fresh server list retain the original time without applying the old acknowledgment", () => {
  const original = [event()];
  const view = renderDisplay(original);
  act(() => view.result.current.confirm(moved(10)));
  const incoming = [{ ...original[0]!, subject: "Updated on the server" }];
  view.rerender({ events: incoming });
  expect(view.result.current.activities[0]).toBe(incoming[0]);
  expect(view.result.current.activities[0]!.subject).toBe("Updated on the server");
  expect(view.result.current.activities[0]!.dueAt).toBe(original[0]!.dueAt);
});

it("ignores an acknowledgment callback captured before a newer server list arrived", () => {
  const original = [event()];
  const view = renderDisplay(original);
  const confirmBeforeRefresh = view.result.current.confirm;
  const incoming = [serverEvent(original[0]!, moved(14))];
  view.rerender({ events: incoming });
  act(() => confirmBeforeRefresh(moved(10)));
  expect(view.result.current.activities[0]).toBe(incoming[0]);
});

it("forgets only the requested event's acknowledgment", () => {
  const incoming = [event(), event("another-meeting")];
  const { result } = renderDisplay(incoming);
  act(() => {
    result.current.confirm(moved(10));
    result.current.confirm(moved(12, "another-meeting"));
  });
  act(() => result.current.forget("meeting"));
  expect(result.current.activities[0]).toBe(incoming[0]);
  expect(result.current.activities[1]!.dueAt.toISOString()).toBe(moved(12).dueAt);
  act(() => result.current.forget("already-absent"));
  expect(result.current.activities[1]!.dueAt.toISOString()).toBe(moved(12).dueAt);
});

it("clones only schedule fields, keeps Date values and metadata, and leaves both inputs untouched", () => {
  const original = event();
  const untouched = event("another-meeting");
  const incoming = [original, untouched];
  const schedule = moved(10);
  const before = JSON.stringify(incoming);
  const scheduleBefore = { ...schedule };
  Object.freeze(incoming);
  Object.freeze(original);
  Object.freeze(schedule);
  const { result } = renderDisplay(incoming);
  act(() => result.current.confirm(schedule));
  const shown = result.current.activities[0]!;
  expect(shown).not.toBe(original);
  expect(shown.dueAt).toBeInstanceOf(Date);
  expect(shown.endAt).toBeInstanceOf(Date);
  expect(shown).toEqual(serverEvent(original, schedule));
  expect(result.current.activities[1]).toBe(untouched);
  expect(JSON.stringify(incoming)).toBe(before);
  expect(schedule).toEqual(scheduleBefore);
  shown.dueAt.setTime(0);
  expect(original.dueAt.toISOString()).toBe("2026-11-05T08:00:29.123Z");
});

it("preserves nullable and civil schedule fields from an acknowledged all-day move", () => {
  const incoming = [event()];
  const schedule: CalendarRescheduleValue = {
    id: incoming[0]!.id,
    dueAt: "2026-11-07T00:00:00.000Z",
    endAt: null,
    allDay: true,
    dueDate: "2026-11-07",
    endDate: "2026-11-09",
    durationMinutes: null,
  };
  const { result } = renderDisplay(incoming);
  act(() => result.current.confirm(schedule));
  expect(result.current.activities[0]).toEqual(serverEvent(incoming[0]!, schedule));
  expect(result.current.activities[0]!.endAt).toBeNull();
});
