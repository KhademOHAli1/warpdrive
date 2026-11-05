import { beforeEach, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { rescheduleCalendarEventAction } from "./calendarRescheduleAction";
import type { CalendarRescheduleActionResult } from "./calendarRescheduleSchemas";
import { verifyCalendarUndo } from "./calendarRescheduleUndo";

const deps = vi.hoisted(() => ({
  csrf: vi.fn(),
  session: vi.fn(),
  authority: vi.fn(),
  move: vi.fn(),
  after: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: deps.csrf }));
vi.mock("./calendarRequestSession", () => ({ readCalendarRequestSession: deps.session }));
vi.mock("./calendarNativeAuthority", () => ({ withCalendarActor: deps.authority }));
vi.mock("./calendarReschedule", () => ({ rescheduleCalendarEvent: deps.move }));
vi.mock("./calendarAfterCommit", () => ({ afterCalendarCommit: deps.after }));

const actorId = "00000000-0000-4000-8000-000000000001";
const id = "00000000-0000-4000-8000-000000000002";
const source = {
  dueAt: "2026-11-05T09:00:00.000Z",
  endAt: null,
  allDay: false,
  dueDate: null,
  endDate: null,
  durationMinutes: 60,
};
const input = {
  v: 1,
  expectedActorId: actorId,
  activity: {
    id,
    expected: source,
    timeZone: "UTC",
    target: { date: "2026-11-06", time: "09:15" },
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  deps.csrf.mockResolvedValue({ ok: true });
});

it("rejects CSRF before credentials, actor authority or schedule effects", async () => {
  deps.csrf.mockResolvedValue({ ok: false });
  expect(await rescheduleCalendarEventAction(input, "wrong")).toEqual({
    ok: false,
    error: { id: "E_AUTH_CSRF" },
  });
  expect(deps.session).not.toHaveBeenCalled();
  expect(deps.authority).not.toHaveBeenCalled();
  expect(deps.move).not.toHaveBeenCalled();
});

it("rejects a forged record patch before loading its credential", async () => {
  expect(
    await rescheduleCalendarEventAction(
      { ...input, activity: { ...input.activity, subject: "Change it" } },
      "csrf",
    ),
  ).toEqual({ ok: false, error: { id: ERROR_IDS.ACTIVITY_NATIVE_INPUT_INVALID } });
  expect(deps.session).not.toHaveBeenCalled();
  expect(deps.move).not.toHaveBeenCalled();
});

it("requires an actual cookie-bound session", async () => {
  deps.session.mockResolvedValue(null);
  expect(await rescheduleCalendarEventAction(input, "csrf")).toEqual({
    ok: false,
    error: { id: ERROR_IDS.AUTH_SESSION_DEAD },
  });
  expect(deps.authority).not.toHaveBeenCalled();
});

it("binds the confirmed timing receipt to the actor, session, event and both stored schedules", async () => {
  const who = { userId: actorId, sessionId: id };
  const actor = { id: actorId };
  const tx = {};
  const value = { id, ...source, dueAt: "2026-11-06T09:15:00.000Z" };
  deps.session.mockResolvedValue(who);
  deps.move.mockResolvedValue({ ok: true, value });
  deps.authority.mockImplementation(
    (
      _db: unknown,
      _who: unknown,
      _id: unknown,
      _signal: unknown,
      apply: (transaction: object, currentActor: object) => Promise<CalendarRescheduleActionResult>,
    ) => apply(tx, actor),
  );
  const result = await rescheduleCalendarEventAction(input, "csrf");
  expect(result).toEqual({ ok: true, value, undoToken: expect.stringMatching(/^[\w-]{43}$/) });
  if (!result.ok || result.undoToken === undefined) throw new Error("Missing undo receipt");
  const binding = {
    actorId,
    sessionId: who.sessionId,
    id,
    timeZone: "UTC",
    expected: value,
    original: source,
  };
  expect(verifyCalendarUndo(binding, result.undoToken)).toBe(true);
  for (const changed of [
    { ...binding, actorId: id },
    { ...binding, sessionId: actorId },
    { ...binding, id: actorId },
    { ...binding, timeZone: "Europe/Berlin" },
    { ...binding, original: { ...source, durationMinutes: null } },
    { ...binding, expected: { ...value, endAt: "2026-11-06T10:15:00.000Z" } },
  ])
    expect(verifyCalendarUndo(changed, result.undoToken)).toBe(false);
  expect(deps.authority).toHaveBeenCalledWith(
    {},
    who,
    actorId,
    expect.any(AbortSignal),
    expect.any(Function),
  );
  expect(deps.move).toHaveBeenCalledWith(
    tx,
    actor,
    input.activity,
    expect.any(AbortSignal),
    who.sessionId,
  );
  expect(deps.after).toHaveBeenCalledWith(id);
});

it("does not issue another receipt for a no-op or acknowledged undo", async () => {
  deps.session.mockResolvedValue({ userId: actorId, sessionId: id });
  const value = { id, ...source };
  deps.authority.mockResolvedValue({ ok: true, value });
  expect(await rescheduleCalendarEventAction(input, "csrf")).toEqual({ ok: true, value });
  expect(
    await rescheduleCalendarEventAction(
      {
        ...input,
        activity: {
          ...input.activity,
          expected: { ...source, dueAt: "2026-11-06T09:15:00.000Z" },
          target: { undo: source, token: "a".repeat(43) },
        },
      },
      "csrf",
    ),
  ).toEqual({ ok: true, value });
});

it("does not nudge reminders after an authority or stale-source denial", async () => {
  deps.session.mockResolvedValue({ userId: actorId, sessionId: id });
  deps.authority.mockResolvedValue({ ok: false, error: { id: ERROR_IDS.ACTIVITY_SCHEDULE_STALE } });
  expect(await rescheduleCalendarEventAction(input, "csrf")).toEqual({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_SCHEDULE_STALE },
  });
  expect(deps.after).not.toHaveBeenCalled();
});
