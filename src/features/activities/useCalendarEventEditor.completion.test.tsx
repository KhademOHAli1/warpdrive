// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";

import type { EditableActivity } from "./getForEdit";
import { useCalendarEventEditor } from "./useCalendarEventEditor";

const api = vi.hoisted(() => ({
  createCalendarEventAction: vi.fn(),
  editCalendarEventAction: vi.fn(),
  deleteCalendarEventAction: vi.fn(),
  readCalendarEventAction: vi.fn(),
  retryCalendarReminderAction: vi.fn(),
  completeCalendarEventAction: vi.fn(),
}));
vi.mock("./calendarNativeActions", () => api);
vi.mock("./reminderSettingsActions", () => ({ setEventReminderSettingsAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    calendars: {
      list: {
        useQuery: () => ({
          data: [{ id: "00000000-0000-4000-8000-000000000010", role: "owner", timeZone: "UTC" }],
        }),
      },
    },
    activities: {
      listTypes: {
        useQuery: () => ({
          data: [{ id: "00000000-0000-4000-8000-000000000002", key: "meeting", name: "Meeting" }],
        }),
      },
    },
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: () => Promise.resolve() },
        listRows: { invalidate: () => Promise.resolve() },
      },
    }),
  },
}));

const stored: EditableActivity = {
  id: "00000000-0000-4000-8000-000000000001",
  typeId: "00000000-0000-4000-8000-000000000002",
  subject: "Before completion",
  priority: null,
  dueAt: "2030-03-21T09:00:00.000Z",
  endAt: "2030-03-21T10:00:00.000Z",
  durationMinutes: 60,
  allDay: false,
  dueDate: null,
  endDate: null,
  location: null,
  note: null,
  videoCallUrl: null,
  assigneeId: "00000000-0000-4000-8000-000000000003",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  guestPersonIds: [],
  participantUserIds: [],
  dealTitle: null,
  personName: null,
  orgName: null,
  version: 4,
  calendarId: "00000000-0000-4000-8000-000000000010",
  eventTimeZone: "UTC",
};

beforeEach(() => {
  vi.resetAllMocks();
  api.editCalendarEventAction.mockResolvedValue({ ok: true, value: { id: stored.id } });
});
afterEach(cleanup);

test.each([4, 9])(
  "uses freshly read event version %s after completion for the next edit",
  async (version) => {
    api.completeCalendarEventAction.mockResolvedValue({ ok: true, value: { id: stored.id } });
    api.readCalendarEventAction.mockResolvedValue({
      ok: true,
      value: { ...stored, done: true, version },
    });
    const { result } = renderHook(
      () => useCalendarEventEditor({ editing: stored, onClose: vi.fn() }),
      {
        wrapper: ({ children }) => (
          <NativeActorProvider actorId={stored.assigneeId}>{children}</NativeActorProvider>
        ),
      },
    );
    await act(async () => {
      await result.current.manage("complete");
    });
    expect(api.completeCalendarEventAction).toHaveBeenCalledExactlyOnceWith(
      {
        v: 1,
        expectedActorId: stored.assigneeId,
        activity: { id: stored.id, done: true, expectedVersion: 4 },
      },
      "csrf",
    );
    expect(api.readCalendarEventAction).toHaveBeenCalledExactlyOnceWith(
      { v: 1, expectedActorId: stored.assigneeId, activityId: stored.id },
      "csrf",
    );
    expect(result.current.error).toBeNull();
    expect(result.current.doneNow).toBe(true);
    act(() => result.current.change({ subject: "Edited after completion" }));
    await act(async () => {
      await result.current.save();
    });
    expect(api.editCalendarEventAction).toHaveBeenCalledExactlyOnceWith(
      {
        v: 1,
        expectedActorId: stored.assigneeId,
        activity: expect.objectContaining({
          id: stored.id,
          subject: "Edited after completion",
          expectedVersion: version,
        }),
      },
      "csrf",
    );
    expect(result.current.error).toBeNull();
  },
);
