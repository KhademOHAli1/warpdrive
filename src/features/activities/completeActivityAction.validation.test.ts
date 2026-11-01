import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db, pool } from "@/db/client";
import type { Activity } from "@/db/schema/activities";
import type { guardCsrf } from "@/features/identity/actions/shared";
import type { AppContext } from "@/server/trpc/context";
import { err, ok } from "@/types/result";
import type { completeActivity } from "./repo";

const boundary = vi.hoisted(() => ({
  context: vi.fn<() => Promise<AppContext>>(),
  csrf: vi.fn<typeof guardCsrf>(),
  complete: vi.fn<typeof completeActivity>(),
}));
vi.mock("@/server/trpc/context", () => ({ createContext: boundary.context }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: boundary.csrf }));
// Only request and domain-command boundaries are substituted. The real Drizzle/Pool instance is
// unconnected, and no database operation or query builder is replaced or simulated.
vi.mock("./repo", () => ({ completeActivity: boundary.complete, createActivity: vi.fn() }));
vi.mock("./activityDelete", () => ({ deleteActivity: vi.fn() }));
vi.mock("./activityUpdate", () => ({ updateActivity: vi.fn() }));
vi.mock("./notifyHelpers", () => ({ notifyOnActivityCreated: vi.fn() }));

import { completeActivityAction } from "./actions";

const ACTIVITY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const INPUT_INVALID = "E_ACTIVITY_008";
const context: AppContext = {
  db,
  actor: {
    id: USER_ID,
    type: "regular",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
    name: "Native operator",
    email: "operator@example.test",
    avatarUrl: null,
  },
  session: { userId: USER_ID, sessionId: "native-session" },
};
const activity: Activity = {
  id: ACTIVITY_ID,
  typeId: "33333333-3333-4333-8333-333333333333",
  subject: "Call Acme",
  allDay: false,
  dueAt: null,
  dueDate: null,
  endDate: null,
  endAt: null,
  durationMinutes: null,
  priority: null,
  done: false,
  doneAt: null,
  ownerId: USER_ID,
  assigneeId: USER_ID,
  dealId: null,
  leadId: null,
  personId: null,
  orgId: null,
  customFields: {},
  location: null,
  note: null,
  videoCallUrl: null,
  createdAt: new Date("2026-11-01T08:00:00Z"),
  updatedAt: new Date("2026-11-01T08:00:00Z"),
  deletedAt: null,
};

function request(input: unknown, csrfToken: string | null = "csrf") {
  // @ts-expect-error Deliberately cross the external action boundary beyond its static contract.
  return completeActivityAction(input, csrfToken);
}

beforeEach(() => {
  boundary.csrf.mockReset().mockResolvedValue(ok(true));
  boundary.context.mockReset().mockResolvedValue(context);
  boundary.complete.mockReset().mockResolvedValue(ok(activity));
});
afterAll(async () => pool.end());

test.each([true, false])(
  "forwards canonical done=%s through the existing native command",
  async (done) => {
    expect(await request({ id: ACTIVITY_ID, done })).toEqual({
      ok: true,
      value: { id: ACTIVITY_ID },
    });
    expect(boundary.csrf).toHaveBeenCalledExactlyOnceWith("csrf");
    expect(boundary.context).toHaveBeenCalledOnce();
    expect(boundary.complete).toHaveBeenCalledExactlyOnceWith(
      db,
      context.actor,
      ACTIVITY_ID,
      done,
      expect.any(AbortSignal),
    );
    expect(boundary.csrf.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.context.mock.invocationCallOrder[0],
    );
    expect(boundary.context.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.complete.mock.invocationCallOrder[0],
    );
  },
);

test.each([
  ["string false", { id: ACTIVITY_ID, done: "false" }],
  ["string true", { id: ACTIVITY_ID, done: "true" }],
  ["null done", { id: ACTIVITY_ID, done: null }],
  ["missing done", { id: ACTIVITY_ID }],
  ["numeric zero", { id: ACTIVITY_ID, done: 0 }],
  ["numeric one", { id: ACTIVITY_ID, done: 1 }],
  ["missing id", { done: false }],
  ["non-UUID id", { id: "not-an-activity-id", done: false }],
  ["null id", { id: null, done: true }],
  ["unknown key", { id: ACTIVITY_ID, done: true, extra: true }],
  ["actor override", { id: ACTIVITY_ID, done: false, actor: { id: USER_ID } }],
  ["actor ID override", { id: ACTIVITY_ID, done: false, actorId: USER_ID }],
  ["version field", { id: ACTIVITY_ID, done: true, version: 1 }],
  ["revision field", { id: ACTIVITY_ID, done: true, expectedUpdatedAt: "2026-11-01T08:00:00Z" }],
  ["null input", null],
  ["missing input", undefined],
  ["array input", []],
])("rejects %s without invoking the completion command", async (_label, input) => {
  expect(await request(input)).toEqual({ ok: false, error: { id: INPUT_INVALID } });
  expect(boundary.complete).not.toHaveBeenCalled();
});

test.each([
  { id: ACTIVITY_ID, done: true },
  { id: ACTIVITY_ID, done: "false" },
])("retains CSRF refusal before context or input admission: %j", async (input) => {
  boundary.csrf.mockResolvedValue(err("denied"));
  expect(await request(input, "bad-csrf")).toEqual({
    ok: false,
    error: { id: "E_AUTH_CSRF" },
  });
  expect(boundary.context).not.toHaveBeenCalled();
  expect(boundary.complete).not.toHaveBeenCalled();
});

test.each([
  { id: ACTIVITY_ID, done: false },
  { id: ACTIVITY_ID, done: null },
])("retains missing-actor refusal before the completion command: %j", async (input) => {
  boundary.context.mockResolvedValue({ ...context, actor: null });
  expect(await request(input)).toEqual({
    ok: false,
    error: { id: ERROR_IDS.AUTH_SESSION_DEAD },
  });
  expect(boundary.complete).not.toHaveBeenCalled();
});

test("retains record-scoped command permission refusal and its stable ActionResult", async () => {
  boundary.complete.mockResolvedValue(
    err(new AppError(ERROR_IDS.ACTIVITY_FORBIDDEN, "private command details")),
  );
  expect(await request({ id: ACTIVITY_ID, done: true })).toEqual({
    ok: false,
    error: { id: ERROR_IDS.ACTIVITY_FORBIDDEN },
  });
});
