import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { users } from "@/db/schema/identity";
import { integrationConnections, integrationEvents } from "@/db/schema/integrations";
import { encryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { beginSlackConnection, finishSlackConnection } from "./service";

const OWNER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const CONNECTION = "10000000-0000-4000-8000-000000000101";
const TEAM = "TLOCAL001";
const SCOPES = ["chat:write", "channels:read", "users:read"];
const SETTINGS = { channelId: "CLOCAL001", channelName: "historical-channel" };
const OLD = new Date("2020-01-01T00:00:00Z");
const original = { id: env.SLACK_CLIENT_ID, secret: env.SLACK_CLIENT_SECRET };
let h: TestDb | undefined;
let signal: AbortSignal;
const grants = new Map<string, { team: string; token: string; scopes: string[] }>();

async function checked<T>(run: () => PromiseLike<T>): Promise<T> {
  signal.throwIfAborted();
  const value = await run();
  signal.throwIfAborted();
  return value;
}
function fixture() {
  if (!h) throw new Error("connection custody fixture missing");
  return h;
}
async function snapshot() {
  const connections = await checked(() =>
    fixture().db.select().from(integrationConnections).orderBy(integrationConnections.id),
  );
  const events = await checked(() =>
    fixture().db.select().from(integrationEvents).orderBy(integrationEvents.id),
  );
  return {
    connections: connections.map(({ credentials, ...row }) => ({
      ...row,
      credentialHash:
        credentials === null ? null : createHash("sha256").update(credentials).digest("hex"),
    })),
    events,
  };
}
async function callback(actor: string, code: string, team = TEAM, scopes = SCOPES) {
  const sessionId = randomUUID();
  const attempt = await checked(() => beginSlackConnection(fixture().db, actor, sessionId));
  grants.set(code, { team, token: `synthetic-custody:${code}`, scopes });
  return checked(() =>
    finishSlackConnection(fixture().db, {
      state: attempt.state,
      cookieState: attempt.state,
      userId: actor,
      sessionId,
      code,
    }),
  );
}

beforeEach(async () => {
  h = undefined;
  signal = AbortSignal.timeout(12_000);
  grants.clear();
  h = await makeTestDb();
  Object.assign(h.pool.options, {
    connectionTimeoutMillis: 3_000,
    statement_timeout: 5_000,
    query_timeout: 6_000,
    lock_timeout: 1_000,
    idle_in_transaction_session_timeout: 6_000,
  });
  env.SLACK_CLIENT_ID = "synthetic-custody-client";
  env.SLACK_CLIENT_SECRET = "synthetic-custody-secret";
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((resource, init) => {
      AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]).throwIfAborted();
      if (resource !== "https://slack.com/api/oauth.v2.access")
        throw new Error("unexpected custody fixture provider request");
      if (!(init?.body instanceof URLSearchParams))
        throw new Error("unexpected custody fixture provider body");
      const code = init.body.get("code");
      const grant = code === null ? undefined : grants.get(code);
      if (!grant) throw new Error("missing custody fixture provider response");
      return Promise.resolve(
        Response.json({
          ok: true,
          access_token: grant.token,
          scope: grant.scopes.join(","),
          team: { id: grant.team, name: "Synthetic workspace" },
        }),
      );
    }),
  );
  await checked(() =>
    h!.db.insert(users).values([
      {
        id: OWNER,
        email: "custody-owner@example.test",
        name: "Owner A",
        isAdmin: true,
        isActive: true,
      },
      {
        id: OTHER,
        email: "custody-other@example.test",
        name: "Admin B",
        isAdmin: true,
        isActive: true,
      },
    ]),
  );
  await checked(() =>
    h!.db.insert(integrationConnections).values({
      id: CONNECTION,
      provider: "slack",
      accountId: TEAM,
      accountName: "Synthetic workspace",
      ownerId: OWNER,
      credentials: encryptToken(JSON.stringify({ token: "synthetic-historical-custody" })),
      scopes: SCOPES,
      settings: SETTINGS,
      status: "connected",
      connectedAt: OLD,
      updatedAt: OLD,
      lastCheckedAt: OLD,
    }),
  );
  await checked(() =>
    h!.db.insert(integrationEvents).values([
      {
        id: "20000000-0000-4000-8000-000000000001",
        connectionId: CONNECTION,
        actorId: OWNER,
        action: "connected",
        createdAt: OLD,
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        connectionId: CONNECTION,
        actorId: OWNER,
        action: "configured",
        createdAt: new Date("2020-01-02T00:00:00Z"),
      },
    ]),
  );
}, 20_000);

afterEach(async () => {
  try {
    await h?.close();
  } finally {
    h = undefined;
    vi.unstubAllGlobals();
    env.SLACK_CLIENT_ID = original.id;
    env.SLACK_CLIENT_SECRET = original.secret;
  }
}, 20_000);

it("refuses another admin's same-workspace callback without replacing custody or history", async () => {
  const before = await snapshot();
  const outcome = await callback(OTHER, "other-admin", TEAM, ["chat:write", "channels:read"]).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  const after = await snapshot();
  // Soft checks retain persisted evidence even when the legacy callback wrongly fulfills.
  expect.soft(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") {
    expect.soft(outcome.reason).toBeInstanceOf(AppError);
    expect.soft(outcome.reason).toMatchObject({
      id: ERROR_IDS.INTEGRATION_CUSTODY_CONFLICT,
      message: "integration_custody_conflict",
    });
    if (outcome.reason instanceof AppError) expect.soft(outcome.reason.context).toEqual({});
    expect.soft(ERROR_IDS.INTEGRATION_CUSTODY_CONFLICT).toBe("E_INTEGRATION_015");
  }
  expect.soft(after.connections).toEqual(before.connections);
  expect.soft(after.events).toEqual(before.events);
  expect(fetch).toHaveBeenCalledTimes(1);
}, 15_000);

it("keeps one connection and its selected channel/history on same-owner sequential reconnect", async () => {
  const before = await snapshot();
  expect(await callback(OWNER, "same-owner-first")).toBe(CONNECTION);
  const first = await snapshot();
  expect(await callback(OWNER, "same-owner-second")).toBe(CONNECTION);
  const after = await snapshot();
  expect(after.connections).toHaveLength(1);
  expect(after.connections[0]).toMatchObject({
    id: CONNECTION,
    accountId: TEAM,
    ownerId: OWNER,
    scopes: SCOPES,
    settings: SETTINGS,
    status: "connected",
    lastCheckedAt: null,
  });
  expect(after.connections[0]!.credentialHash).not.toBe(first.connections[0]!.credentialHash);
  expect(first.connections[0]!.credentialHash).not.toBe(before.connections[0]!.credentialHash);
  expect(after.connections[0]!.connectedAt.getTime()).toBeGreaterThan(OLD.getTime());
  expect(after.events.filter((event) => before.events.some((old) => old.id === event.id))).toEqual(
    before.events,
  );
  const added = after.events.filter((event) => !before.events.some((old) => old.id === event.id));
  expect(added).toHaveLength(2);
  expect(
    added.every(
      (event) =>
        event.connectionId === CONNECTION &&
        event.actorId === OWNER &&
        event.action === "connected",
    ),
  ).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
}, 15_000);

it("allows distinct stable workspace IDs with identical display names through valid callbacks", async () => {
  const before = await snapshot();
  const first = await callback(OWNER, "distinct-one", "TLOCAL002");
  const second = await callback(OTHER, "distinct-two", "TLOCAL003");
  const after = await snapshot();
  expect(new Set([CONNECTION, first, second]).size).toBe(3);
  expect(after.connections).toHaveLength(3);
  expect(after.connections.find((row) => row.id === CONNECTION)).toEqual(before.connections[0]);
  expect(after.connections.find((row) => row.id === first)).toMatchObject({
    accountId: "TLOCAL002",
    ownerId: OWNER,
  });
  expect(after.connections.find((row) => row.id === second)).toMatchObject({
    accountId: "TLOCAL003",
    ownerId: OTHER,
  });
  expect(after.events.filter((event) => before.events.some((old) => old.id === event.id))).toEqual(
    before.events,
  );
  expect(after.events.filter((event) => [first, second].includes(event.connectionId))).toHaveLength(
    2,
  );
  expect(fetch).toHaveBeenCalledTimes(2);
}, 15_000);
