import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { users } from "@/db/schema/identity";
import { integrationConnections, integrationEvents } from "@/db/schema/integrations";
import { encryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { beginSlackConnection, finishSlackConnection, withSlackConnection } from "./service";

const OWNER = "41000000-0000-4000-8000-000000000001";
const CONNECTION = "41000000-0000-4000-8000-000000000101";
const TEAM = "TREAUTO001";
const SCOPES = ["chat:write", "channels:read"];
const SETTINGS = { channelId: "CREAUTO001", channelName: "retained-channel" };
const OLD = new Date("2020-01-01T00:00:00Z");
const CANDIDATE = "synthetic-reauthorization-candidate";
const original = { id: env.SLACK_CLIENT_ID, secret: env.SLACK_CLIENT_SECRET };
let h: TestDb | undefined;
let signal: AbortSignal;
const grants = new Map<string, string[]>();

function fixture() {
  assert(h, "reauthorization fixture missing");
  return h;
}

async function checked<T>(run: () => PromiseLike<T>): Promise<T> {
  signal.throwIfAborted();
  const result = await run();
  signal.throwIfAborted();
  return result;
}

async function snapshot() {
  const rows = await checked(() => fixture().db.select().from(integrationConnections));
  assert(rows.length === 1 && rows[0], "reauthorization connection fixture missing");
  const { credentials, ...connection } = rows[0];
  const events = await checked(() =>
    fixture().db.select().from(integrationEvents).orderBy(integrationEvents.id),
  );
  return {
    connection,
    credentialHash:
      credentials === null ? null : createHash("sha256").update(credentials).digest("hex"),
    events,
  };
}

async function callback(code: string, scopes: string[]) {
  const sessionId = randomUUID();
  const attempt = await checked(() => beginSlackConnection(fixture().db, OWNER, sessionId));
  grants.set(code, scopes);
  return checked(() =>
    finishSlackConnection(fixture().db, {
      state: attempt.state,
      cookieState: attempt.state,
      userId: OWNER,
      sessionId,
      code,
    }),
  );
}

async function candidateIsUsable() {
  try {
    return await checked(() =>
      withSlackConnection(fixture().db, OWNER, CONNECTION, (token) =>
        Promise.resolve(token === CANDIDATE),
      ),
    );
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof AppError && error.id === ERROR_IDS.INTEGRATION_NOT_CONNECTED) return false;
    throw error;
  }
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
  env.SLACK_CLIENT_ID = "synthetic-reauthorization-client";
  env.SLACK_CLIENT_SECRET = "synthetic-reauthorization-secret";
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((resource, init) => {
      AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]).throwIfAborted();
      assert(resource === "https://slack.com/api/oauth.v2.access", "unexpected fixture endpoint");
      assert(init?.method === "POST", "unexpected fixture method");
      assert(init.body instanceof URLSearchParams, "unexpected fixture body");
      const code = init.body.get("code");
      const scopes = code === null ? undefined : grants.get(code);
      assert(scopes, "missing fixture grant");
      return Promise.resolve(
        Response.json({
          ok: true,
          access_token: CANDIDATE,
          scope: scopes.join(","),
          team: { id: TEAM, name: "Reauthorization workspace" },
        }),
      );
    }),
  );
  await checked(() =>
    fixture().db.insert(users).values({
      id: OWNER,
      email: "reauthorization-owner@example.test",
      name: "Reauthorization owner",
      isAdmin: true,
      isActive: true,
    }),
  );
  await checked(() =>
    fixture()
      .db.insert(integrationConnections)
      .values({
        id: CONNECTION,
        provider: "slack",
        accountId: TEAM,
        accountName: "Reauthorization workspace",
        ownerId: OWNER,
        credentials: encryptToken(JSON.stringify({ token: "synthetic-reauthorization-existing" })),
        scopes: SCOPES,
        settings: SETTINGS,
        status: "connected",
        connectedAt: OLD,
        updatedAt: OLD,
        lastCheckedAt: OLD,
      }),
  );
  await checked(() =>
    fixture().db.insert(integrationEvents).values({
      id: "41000000-0000-4000-8000-000000000201",
      connectionId: CONNECTION,
      actorId: OWNER,
      action: "configured",
      createdAt: OLD,
    }),
  );
}, 20_000);

afterEach(async () => {
  try {
    await h?.close();
  } finally {
    h = undefined;
    grants.clear();
    vi.unstubAllGlobals();
    env.SLACK_CLIENT_ID = original.id;
    env.SLACK_CLIENT_SECRET = original.secret;
  }
}, 20_000);

it("does not activate broader same-account credentials before local scope review", async () => {
  const before = await snapshot();
  // Rejection or a held candidate is allowed; neither may activate the broader credential.
  await callback("broader-same-account", [...SCOPES, "users:read"]).catch((error: unknown) => {
    signal.throwIfAborted();
    if (!(error instanceof AppError)) throw error;
  });
  const after = await snapshot();
  const added = after.events.filter((event) => !before.events.some((old) => old.id === event.id));
  expect.soft(await candidateIsUsable()).toBe(false);
  expect.soft(after.credentialHash).toBe(before.credentialHash);
  expect.soft(after.connection).toMatchObject({
    id: CONNECTION,
    accountId: TEAM,
    ownerId: OWNER,
    settings: SETTINGS,
    scopes: SCOPES,
  });
  expect
    .soft(after.events.filter((event) => before.events.some((old) => old.id === event.id)))
    .toEqual(before.events);
  expect.soft(added.filter((event) => event.action === "connected")).toHaveLength(0);
  expect(fetch).toHaveBeenCalledTimes(1);
}, 15_000);

it("reconnects the same account with unchanged scopes, retaining settings and history", async () => {
  const before = await snapshot();
  expect(await callback("same-scope-control", [...SCOPES])).toBe(CONNECTION);
  const after = await snapshot();
  const added = after.events.filter((event) => !before.events.some((old) => old.id === event.id));
  expect(await candidateIsUsable()).toBe(true);
  expect(after.credentialHash).not.toBe(before.credentialHash);
  expect(after.connection).toMatchObject({
    id: CONNECTION,
    accountId: TEAM,
    ownerId: OWNER,
    settings: SETTINGS,
    scopes: SCOPES,
    status: "connected",
    lastCheckedAt: null,
  });
  expect(after.connection.connectedAt.getTime()).toBeGreaterThan(OLD.getTime());
  expect(after.events.filter((event) => before.events.some((old) => old.id === event.id))).toEqual(
    before.events,
  );
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ connectionId: CONNECTION, actorId: OWNER, action: "connected" });
  expect(fetch).toHaveBeenCalledTimes(1);
}, 15_000);
