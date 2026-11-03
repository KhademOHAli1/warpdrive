import { beforeEach, expect, it, vi } from "vitest";
import {
  completeCalendarEventAction,
  createCalendarEventAction,
  deleteCalendarEventAction,
  editCalendarEventAction,
  readCalendarEventAction,
  retryCalendarReminderAction,
} from "./calendarNativeActions";

const deps = vi.hoisted(() => ({
  csrf: vi.fn(),
  credential: vi.fn(),
  authority: vi.fn(),
  effect: vi.fn(),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: deps.csrf }));
vi.mock("./calendarRequestSession", () => ({ readCalendarRequestSession: deps.credential }));
vi.mock("./calendarNativeAuthority", () => ({ withCalendarActor: deps.authority }));
vi.mock("./calendarAfterCommit", () => ({ afterCalendarCommit: deps.effect }));
vi.mock("./repo", () => ({ createActivity: deps.effect, completeActivity: deps.effect }));
vi.mock("./activityUpdate", () => ({ updateActivity: deps.effect }));
vi.mock("./activityDelete", () => ({ deleteActivity: deps.effect }));
vi.mock("./getForEdit", () => ({ getActivityForEdit: deps.effect }));
vi.mock("./reminderRetry", () => ({ retryActivityReminder: deps.effect }));
const commands = [
  createCalendarEventAction,
  editCalendarEventAction,
  completeCalendarEventAction,
  deleteCalendarEventAction,
  readCalendarEventAction,
  retryCalendarReminderAction,
];
beforeEach(() => {
  vi.resetAllMocks();
  deps.csrf.mockResolvedValue({ ok: true });
});

it("every new native entry rejects CSRF before parsing, credentials, authority or effects", async () => {
  deps.csrf.mockResolvedValue({ ok: false });
  for (const command of commands)
    expect(await command(null, "wrong")).toEqual({ ok: false, error: { id: "E_AUTH_CSRF" } });
  expect(deps.credential).not.toHaveBeenCalled();
  expect(deps.authority).not.toHaveBeenCalled();
  expect(deps.effect).not.toHaveBeenCalled();
});
it("every new native entry denies a missing actor/version envelope without loading credentials or mutating", async () => {
  for (const command of commands)
    expect(await command({}, "csrf")).toEqual({ ok: false, error: { id: "E_ACTIVITY_009" } });
  expect(deps.credential).not.toHaveBeenCalled();
  expect(deps.authority).not.toHaveBeenCalled();
  expect(deps.effect).not.toHaveBeenCalled();
});
it("a valid strict envelope still requires the actual server cookie credential", async () => {
  deps.credential.mockResolvedValue(null);
  expect(
    await createCalendarEventAction(
      {
        v: 1,
        expectedActorId: "00000000-0000-4000-8000-000000000001",
        activity: {
          typeId: "00000000-0000-4000-8000-000000000002",
          subject: "Event",
          authoredTimeZone: "UTC",
          reminder: { kind: "none" },
        },
      },
      "csrf",
    ),
  ).toEqual({ ok: false, error: { id: "E_AUTH_003" } });
  expect(deps.credential).toHaveBeenCalledOnce();
  expect(deps.authority).not.toHaveBeenCalled();
  expect(deps.effect).not.toHaveBeenCalled();
});
