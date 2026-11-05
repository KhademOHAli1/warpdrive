// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import type { CalendarActivity } from "./calendar";
import type {
  CalendarRescheduleActionResult,
  CalendarRescheduleValue,
} from "./calendarRescheduleSchemas";
import { type CalendarMoveResult, useCalendarReschedule } from "./useCalendarReschedule";

const api = vi.hoisted(() => ({
  move: vi.fn<(raw: unknown, csrf: string | null) => Promise<CalendarRescheduleActionResult>>(),
  csrf: vi.fn<() => string | null>(),
  invalidate: vi.fn<() => Promise<void>>(),
  onMoved: vi.fn<(schedule: CalendarRescheduleValue) => void>(),
  onRefresh: vi.fn<() => Promise<void>>(),
}));
vi.mock("./calendarRescheduleAction", () => ({ rescheduleCalendarEventAction: api.move }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: api.csrf }));
vi.mock("./useInvalidateActivityLists", () => ({
  useInvalidateActivityLists: () => api.invalidate,
}));

const firstActor = "00000000-0000-4000-8000-000000000001";
let actorId = firstActor;
const activity: CalendarActivity = {
  id: "00000000-0000-4000-8000-000000000002",
  subject: "Existing meeting",
  dueAt: new Date("2026-10-25T01:30:29.123Z"),
  endAt: new Date("2026-10-25T02:30:29.123Z"),
  allDay: false,
  durationMinutes: 60,
  typeKey: "meeting",
  done: false,
  dealId: null,
  personId: null,
  orgId: null,
  overdue: false,
  ownerName: null,
};
const target = { date: "2026-10-26", time: "14:15" };
const schedule: CalendarRescheduleValue = {
  id: activity.id,
  dueAt: "2026-10-26T13:15:00.000Z",
  endAt: "2026-10-26T14:15:00.000Z",
  allDay: false,
  durationMinutes: 60,
  dueDate: null,
  endDate: null,
};

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NativeActorProvider actorId={actorId}>
      <LocaleProvider locale="en" timeZone="Europe/Berlin">
        {children}
      </LocaleProvider>
    </NativeActorProvider>
  );
}

function renderMover() {
  return renderHook(
    () => useCalendarReschedule({ onMoved: api.onMoved, onRefresh: api.onRefresh }),
    { wrapper },
  );
}

beforeEach(() => {
  actorId = firstActor;
  api.move.mockReset().mockResolvedValue({ ok: true, value: schedule });
  api.csrf.mockReset().mockReturnValue("csrf");
  api.invalidate.mockReset().mockResolvedValue(undefined);
  api.onMoved.mockReset();
  api.onRefresh.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it("sends the actor, CSRF and exact source schedule and displays only the acknowledged values", async () => {
  let finishRefresh!: () => void;
  api.invalidate.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }),
  );
  const { result } = renderMover();
  let operation!: Promise<CalendarMoveResult>;
  act(() => {
    operation = result.current.move(activity, target);
  });
  await waitFor(() => expect(api.onMoved).toHaveBeenCalledWith(schedule));
  expect(result.current.pending).toBe(true);
  expect(api.move).toHaveBeenCalledWith(
    {
      v: 1,
      expectedActorId: firstActor,
      activity: {
        id: activity.id,
        timeZone: "Europe/Berlin",
        expected: {
          dueAt: "2026-10-25T01:30:29.123Z",
          endAt: "2026-10-25T02:30:29.123Z",
          allDay: false,
          dueDate: null,
          endDate: null,
          durationMinutes: 60,
        },
        target,
      },
    },
    "csrf",
  );
  let outcome!: CalendarMoveResult;
  await act(async () => {
    finishRefresh();
    outcome = await operation;
  });
  expect(outcome).toEqual({ kind: "saved", schedule });
  expect(result.current.notice).toMatch(/moved/i);
  expect(result.current.error).toBeNull();
  expect(result.current.pending).toBe(false);
  expect(api.onRefresh).toHaveBeenCalledTimes(1);
  expect(api.move).toHaveBeenCalledTimes(1);
});

it("uses a mutex so two drops in the same render cannot dispatch two writes", async () => {
  let finish!: (value: CalendarRescheduleActionResult) => void;
  api.move.mockReturnValueOnce(
    new Promise<CalendarRescheduleActionResult>((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = renderMover();
  let first!: Promise<CalendarMoveResult>;
  let ignored!: CalendarMoveResult;
  await act(async () => {
    first = result.current.move(activity, target);
    ignored = await result.current.move(activity, target);
  });
  expect(ignored).toEqual({ kind: "ignored" });
  expect(api.move).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ ok: true, value: schedule });
    await first;
  });
  expect(api.onMoved).toHaveBeenCalledTimes(1);
});

it.each(["E_ACTIVITY_011", "E_ACTIVITY_010"])(
  "refreshes after stale response %s without a write retry",
  async (id) => {
    api.move.mockResolvedValue({ ok: false, error: { id } });
    const { result } = renderMover();
    let outcome!: CalendarMoveResult;
    await act(async () => {
      outcome = await result.current.move(activity, target);
    });
    expect(outcome).toEqual({ kind: "stale" });
    expect(result.current.error).toMatch(/changed/i);
    expect(result.current.notice).toBeNull();
    expect(api.onMoved).not.toHaveBeenCalled();
    expect(api.invalidate).toHaveBeenCalledTimes(1);
    expect(api.onRefresh).toHaveBeenCalledTimes(1);
    expect(api.move).toHaveBeenCalledTimes(1);
  },
);

it("keeps a known permission denial separate from an unknown move", async () => {
  api.move.mockResolvedValue({ ok: false, error: { id: "E_ACTIVITY_002" } });
  const { result } = renderMover();
  let outcome!: CalendarMoveResult;
  await act(async () => {
    outcome = await result.current.move(activity, target);
  });
  expect(outcome).toEqual({ kind: "rejected" });
  expect(result.current.error).toMatch(/permission/i);
  expect(result.current.notice).toBeNull();
  expect(api.onMoved).not.toHaveBeenCalled();
  expect(api.onRefresh).not.toHaveBeenCalled();
});

it("reconciles a deleted or newly invisible event without retrying its rejected move", async () => {
  api.move.mockResolvedValue({ ok: false, error: { id: "E_ACTIVITY_001" } });
  const { result } = renderMover();
  let outcome!: CalendarMoveResult;
  await act(async () => {
    outcome = await result.current.move(activity, target);
  });
  expect(outcome).toEqual({ kind: "rejected" });
  expect(result.current.error).toMatch(/could not be moved/i);
  expect(result.current.notice).toBeNull();
  expect(result.current.pending).toBe(false);
  expect(api.onMoved).not.toHaveBeenCalled();
  expect(api.invalidate).toHaveBeenCalledTimes(1);
  expect(api.onRefresh).toHaveBeenCalledTimes(1);
  expect(api.move).toHaveBeenCalledTimes(1);
});

it("never labels a lost response as saved and refreshes without repeating the mutation", async () => {
  api.move.mockRejectedValue(new Error("connection lost after dispatch"));
  const { result } = renderMover();
  let outcome!: CalendarMoveResult;
  await act(async () => {
    outcome = await result.current.move(activity, target);
  });
  expect(outcome).toEqual({ kind: "unknown" });
  expect(result.current.error).toMatch(/confirm/i);
  expect(result.current.notice).toBeNull();
  expect(api.onMoved).not.toHaveBeenCalled();
  expect(api.invalidate).toHaveBeenCalledTimes(1);
  expect(api.onRefresh).toHaveBeenCalledTimes(1);
  expect(api.move).toHaveBeenCalledTimes(1);
});

it("still requests route reconciliation if invalidating list caches fails", async () => {
  api.move.mockRejectedValue(new Error("lost response"));
  api.invalidate.mockRejectedValue(new Error("cache refresh failed"));
  const { result } = renderMover();
  await act(async () => {
    await result.current.move(activity, target);
  });
  expect(result.current.notice).toBeNull();
  expect(result.current.error).toMatch(/confirm/i);
  expect(api.onRefresh).toHaveBeenCalledTimes(1);
  expect(api.move).toHaveBeenCalledTimes(1);
});

it("retains the server acknowledgment when only refreshing the calendar fails", async () => {
  api.onRefresh.mockRejectedValue(new Error("route refresh failed"));
  const { result } = renderMover();
  let outcome!: CalendarMoveResult;
  await act(async () => {
    outcome = await result.current.move(activity, target);
  });
  expect(outcome).toEqual({ kind: "saved", schedule });
  expect(result.current.notice).toMatch(/moved/i);
  expect(result.current.error).toMatch(/refresh/i);
  expect(api.onMoved).toHaveBeenCalledWith(schedule);
  expect(api.move).toHaveBeenCalledTimes(1);
});

it("does not send a move without an authenticated actor snapshot", async () => {
  const { result } = renderHook(
    () => useCalendarReschedule({ onMoved: api.onMoved, onRefresh: api.onRefresh }),
    { wrapper: ({ children }) => <LocaleProvider>{children}</LocaleProvider> },
  );
  await act(async () => {
    await result.current.move(activity, target);
  });
  expect(result.current.error).toMatch(/reload/i);
  expect(result.current.canMove).toBe(false);
  expect(api.move).not.toHaveBeenCalled();
  expect(api.csrf).not.toHaveBeenCalled();
});

it("discards a late response after the authenticated account changes", async () => {
  let finish!: (value: CalendarRescheduleActionResult) => void;
  api.move.mockReturnValueOnce(
    new Promise<CalendarRescheduleActionResult>((resolve) => {
      finish = resolve;
    }),
  );
  const view = renderMover();
  let operation!: Promise<CalendarMoveResult>;
  act(() => {
    operation = view.result.current.move(activity, target);
  });
  actorId = "00000000-0000-4000-8000-000000000003";
  view.rerender();
  let outcome!: CalendarMoveResult;
  await act(async () => {
    finish({ ok: true, value: schedule });
    outcome = await operation;
  });
  expect(outcome).toEqual({ kind: "ignored" });
  expect(api.onMoved).not.toHaveBeenCalled();
  expect(api.invalidate).not.toHaveBeenCalled();
  expect(api.onRefresh).not.toHaveBeenCalled();
});

it("does not publish a late result after the calendar unmounts", async () => {
  let finish!: (value: CalendarRescheduleActionResult) => void;
  api.move.mockReturnValueOnce(
    new Promise<CalendarRescheduleActionResult>((resolve) => {
      finish = resolve;
    }),
  );
  const view = renderMover();
  let operation!: Promise<CalendarMoveResult>;
  act(() => {
    operation = view.result.current.move(activity, target);
  });
  view.unmount();
  let outcome!: CalendarMoveResult;
  await act(async () => {
    finish({ ok: true, value: schedule });
    outcome = await operation;
  });
  expect(outcome).toEqual({ kind: "ignored" });
  expect(api.onMoved).not.toHaveBeenCalled();
  expect(api.onRefresh).not.toHaveBeenCalled();
});

it("clears feedback without resubmitting a move", async () => {
  const { result } = renderMover();
  await act(async () => {
    await result.current.move(activity, target);
  });
  act(() => result.current.clearFeedback());
  expect(result.current.error).toBeNull();
  expect(result.current.notice).toBeNull();
  expect(api.move).toHaveBeenCalledTimes(1);
});
