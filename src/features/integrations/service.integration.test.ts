import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { users } from "@/db/schema/identity";
import { integrationConnections, integrationOAuthAttempts } from "@/db/schema/integrations";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  beginSlackConnection,
  disconnectSlack,
  finishSlackConnection,
  withSlackConnection,
} from "./service";

let testDb: TestDb;
let adminId: string;
const sessionId = randomUUID();
const originalConfig = { id: env.SLACK_CLIENT_ID, secret: env.SLACK_CLIENT_SECRET };

beforeEach(async () => {
  testDb = await makeTestDb();
  const [admin] = await testDb.db
    .insert(users)
    .values({ email: `${randomUUID()}@example.test`, name: "Integration admin", isAdmin: true })
    .returning();
  if (!admin) throw new Error("fixture missing");
  adminId = admin.id;
  env.SLACK_CLIENT_ID = "test-id";
  env.SLACK_CLIENT_SECRET = "test-secret";
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ok: true,
        access_token: "synthetic-private-bot-token",
        scope: "chat:write,channels:read",
        team: { id: "T001", name: "Synthetic workspace" },
      }),
    ),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  env.SLACK_CLIENT_ID = originalConfig.id;
  env.SLACK_CLIENT_SECRET = originalConfig.secret;
  await testDb.close();
});

async function connect() {
  const attempt = await beginSlackConnection(testDb.db, adminId, sessionId);
  const input = {
    state: attempt.state,
    cookieState: attempt.state,
    userId: adminId,
    sessionId,
    code: "synthetic-code",
  };
  return { input, id: await finishSlackConnection(testDb.db, input) };
}

it("refuses a regular user before creating an OAuth attempt", async () => {
  await testDb.db.update(users).set({ isAdmin: false }).where(eq(users.id, adminId));
  await expect(beginSlackConnection(testDb.db, adminId, sessionId)).rejects.toThrow(
    "integration_forbidden",
  );
  expect(await testDb.db.select().from(integrationOAuthAttempts)).toHaveLength(0);
});

it("stores only a state hash and rejects another browser session before provider I/O", async () => {
  const attempt = await beginSlackConnection(testDb.db, adminId, sessionId);
  const [stored] = await testDb.db.select().from(integrationOAuthAttempts);
  expect(stored?.stateHash).not.toContain(attempt.state);
  await expect(
    finishSlackConnection(testDb.db, {
      state: attempt.state,
      cookieState: attempt.state,
      userId: adminId,
      sessionId: randomUUID(),
      code: "code",
    }),
  ).rejects.toThrow("integration_state_invalid");
  expect(fetch).not.toHaveBeenCalled();
});

it("consumes an attempt once under concurrent callbacks and encrypts stored credentials", async () => {
  const attempt = await beginSlackConnection(testDb.db, adminId, sessionId);
  const input = {
    state: attempt.state,
    cookieState: attempt.state,
    userId: adminId,
    sessionId,
    code: "code",
  };
  const results = await Promise.allSettled([
    finishSlackConnection(testDb.db, input),
    finishSlackConnection(testDb.db, input),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [connection] = await testDb.db.select().from(integrationConnections);
  expect(connection?.credentials?.toString("utf8")).not.toContain("synthetic-private-bot-token");
  expect(connection?.scopes).toEqual(["chat:write", "channels:read"]);
});

it("refuses credential use after an administrator is deactivated", async () => {
  const { id } = await connect();
  await testDb.db.update(users).set({ isActive: false }).where(eq(users.id, adminId));
  const run = vi.fn();
  await expect(withSlackConnection(testDb.db, adminId, id, run)).rejects.toThrow(
    "integration_forbidden",
  );
  expect(run).not.toHaveBeenCalled();
});

it("blocks local token use even when upstream revocation is temporarily unavailable", async () => {
  const { id } = await connect();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
  );
  await disconnectSlack(testDb.db, adminId, id).catch(() => undefined);
  const run = vi.fn();
  await expect(withSlackConnection(testDb.db, adminId, id, run)).rejects.toThrow(
    "integration_not_connected",
  );
  expect(run).not.toHaveBeenCalled();
});
