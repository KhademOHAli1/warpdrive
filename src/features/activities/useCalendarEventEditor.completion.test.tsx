// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { completeActivityAction, editActivityAction } from "./actions";
import type { EditableActivity } from "./getForEdit";
import { useCalendarEventEditor } from "./useCalendarEventEditor";

const api = vi.hoisted(() => ({
  createActivityAction: vi.fn(),
  editActivityAction: vi.fn<typeof editActivityAction>(),
  deleteActivityAction: vi.fn(),
  completeActivityAction: vi.fn<typeof completeActivityAction>(),
}));
vi.mock("./actions", () => api);
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
  api.editActivityAction.mockResolvedValue({ ok: true, value: { id: stored.id } });
});
afterEach(cleanup);

const cases = [
  {
    label: "missing completion version retains the last known token",
    response: { ok: true, value: { id: stored.id } },
    expectedVersion: 4,
  },
  {
    label: "same authoritative completion version remains the next edit token",
    response: { ok: true, value: { id: stored.id }, version: 4 },
    expectedVersion: 4,
  },
  {
    label: "new authoritative completion version becomes the next edit token",
    response: { ok: true, value: { id: stored.id }, version: 9 },
    expectedVersion: 9,
  },
] satisfies Array<{
  label: string;
  response: Awaited<ReturnType<typeof completeActivityAction>>;
  expectedVersion: number;
}>;

test.each(cases)("$label", async ({ response, expectedVersion }) => {
  api.completeActivityAction.mockResolvedValue(response);
  const { result } = renderHook(() =>
    useCalendarEventEditor({ editing: stored, onClose: vi.fn() }),
  );

  await act(async () => {
    await result.current.manage("complete");
  });
  expect(api.completeActivityAction).toHaveBeenCalledExactlyOnceWith(
    { id: stored.id, done: true, expectedVersion: 4 },
    "csrf",
  );
  expect(result.current.error).toBeNull();
  expect(result.current.doneNow).toBe(true);

  act(() => result.current.change({ subject: "Edited after completion" }));
  await act(async () => {
    await result.current.save();
  });
  expect(api.editActivityAction).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ id: stored.id, subject: "Edited after completion", expectedVersion }),
    "csrf",
  );
  expect(result.current.error).toBeNull();
});
