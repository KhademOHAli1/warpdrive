import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import * as schema from "@/db/schema";
import type { AppContext } from "@/server/trpc/context";
import { router } from "@/server/trpc/trpc";
import { err, ok } from "@/types/result";
import type { NextActionQueuePage } from "./next-action-queue/queueTypes";
import { nextActionQueueProcedure } from "./nextActionQueueProcedure";

const boundary = vi.hoisted(() => ({
  enabled: true,
  read: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  env: {
    get SALES_NEXT_ACTION_QUEUE_ENABLED() {
      return boundary.enabled;
    },
  },
}));
// Isolate the read-command boundary. No database operation is replaced or simulated.
vi.mock("./next-action-queue/readNextActionQueue", () => ({
  readNextActionQueue: boundary.read,
}));

const pool = new Pool({ connectionString: "postgresql://unused:unused@127.0.0.1:1/unused" });
const database = drizzle(pool, { schema });
const context: AppContext = {
  db: database,
  actor: {
    id: "f7b11111-1111-4111-8111-111111111111",
    type: "regular",
    isActive: true,
    flags: new Set(),
    groupIds: new Set(),
    name: "Synthetic operator",
    email: "operator@example.test",
    avatarUrl: null,
  },
  session: { userId: "f7b11111-1111-4111-8111-111111111111", sessionId: "native-session" },
};
const page: NextActionQueuePage = {
  readId: "read-after-authorized-selection",
  asOf: "2026-11-01T10:00:00.000Z",
  timeZone: "Asia/Tehran",
  scope: "mine",
  limit: 25,
  offset: 0,
  total: 0,
  counts: { overdue: 0, missingNextStep: 0 },
  rows: [],
};
const queueRouter = router({ nextActionQueue: nextActionQueueProcedure });
const caller = (ctx = context) => queueRouter.createCaller(ctx);

beforeEach(() => {
  boundary.enabled = true;
  boundary.read.mockReset().mockResolvedValue(ok(page));
});
afterAll(async () => pool.end());

test("an unexposed queue cannot read even with an authenticated native context", async () => {
  boundary.enabled = false;
  await expect(caller().nextActionQueue({})).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(boundary.read).not.toHaveBeenCalled();
});

test.each([
  { ...context, actor: null },
  { ...context, session: null },
])("the API requires both actor and native session", async (ctx) => {
  await expect(caller(ctx).nextActionQueue({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(boundary.read).not.toHaveBeenCalled();
});

test("an inactive captured actor cannot obtain a queue or preference read", async () => {
  if (context.actor === null) throw new Error("fixture actor missing");
  const ctx = { ...context, actor: { ...context.actor, isActive: false } };
  await expect(caller(ctx).nextActionQueue({})).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: ERROR_IDS.PERM_DENIED,
  });
  expect(boundary.read).not.toHaveBeenCalled();
});

test.each([
  { actorId: "another-actor" },
  { asOf: "2099-01-01T00:00:00Z" },
  { timeZone: "UTC" },
  { readId: "client-receipt" },
])("server-owned queue context cannot be supplied by the client: %j", async (input) => {
  // @ts-expect-error Deliberately cross the external runtime boundary with prohibited fields.
  await expect(caller().nextActionQueue(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(boundary.read).not.toHaveBeenCalled();
});

test("passes only validated narrowing and the protected actor to the real read command", async () => {
  await expect(caller().nextActionQueue({})).resolves.toEqual(page);
  expect(boundary.read).toHaveBeenCalledOnce();
  expect(boundary.read).toHaveBeenCalledWith(
    database,
    context.actor,
    { scope: "mine", limit: 25, offset: 0 },
    expect.any(AbortSignal),
  );
});

test.each([
  [ERROR_IDS.PERM_DENIED, "FORBIDDEN"],
  [ERROR_IDS.DB_READ_FAILED, "INTERNAL_SERVER_ERROR"],
] as const)("a failed read returns only its stable error ID: %s", async (id, code) => {
  boundary.read.mockResolvedValue(err(new AppError(id, "private SQL label", { sql: "private" })));
  await expect(caller().nextActionQueue({})).rejects.toMatchObject({ code, message: id });
  try {
    await caller().nextActionQueue({});
  } catch (error) {
    expect(JSON.stringify(error)).not.toContain("private");
  }
});
