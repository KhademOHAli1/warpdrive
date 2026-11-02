import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createMcpResourceFixtures,
  type McpResourceFixtures,
  mcpResource,
} from "@/test/mcpResourceFixtures";
import { exchangeMcpGrant } from "./exchange";
import { sha256Base64Url } from "./pkce";

let h: TestDb | undefined;
let fixture: McpResourceFixtures | undefined;
const signal = () => AbortSignal.timeout(10_000);
beforeEach(async () => {
  h = await makeTestDb();
  fixture = await createMcpResourceFixtures(h);
});
afterEach(async () => {
  try {
    await fixture?.close();
  } finally {
    await h?.close();
    fixture = undefined;
    h = undefined;
  }
});

function refresh(db: Db, f: McpResourceFixtures, token: string, abortSignal: AbortSignal) {
  return exchangeMcpGrant(
    db,
    { ...f.refreshGrant(mcpResource()), refresh_token: token },
    abortSignal,
  );
}

async function independent(f: McpResourceFixtures, abortSignal: AbortSignal) {
  const result = await exchangeMcpGrant(f.ownerDb, f.codeGrant(mcpResource()), abortSignal);
  abortSignal.throwIfAborted();
  expect(result.ok).toBe(true);
  assert(result.ok);
  return result.value.refresh_token;
}

async function chain(f: McpResourceFixtures, abortSignal: AbortSignal) {
  const first = await refresh(f.ownerDb, f, f.refreshToken, abortSignal);
  abortSignal.throwIfAborted();
  expect(first.ok).toBe(true);
  assert(first.ok);
  const second = await refresh(f.ownerDb, f, first.value.refresh_token, abortSignal);
  abortSignal.throwIfAborted();
  expect(second.ok).toBe(true);
  assert(second.ok);
  return {
    root: f.refreshToken,
    intermediate: first.value.refresh_token,
    tip: second.value.refresh_token,
    independent: await independent(f, abortSignal),
  };
}

type Snapshot = Awaited<ReturnType<McpResourceFixtures["snapshot"]>>;
type ExchangeResult = Awaited<ReturnType<typeof exchangeMcpGrant>>;
function credentialKeys(snapshot: Snapshot) {
  return {
    codes: snapshot.codes.map((row) => row.codeHash),
    access: snapshot.access.map((row) => row.jti),
    refresh: snapshot.refresh.map((row) => row.tokenHash),
  };
}

async function expectTipDenied(f: McpResourceFixtures, token: string, abortSignal: AbortSignal) {
  const before = await f.snapshot();
  abortSignal.throwIfAborted();
  expect
    .soft(before.refresh.find((row) => row.tokenHash === sha256Base64Url(token))?.revokedAt)
    .toBeInstanceOf(Date);
  expect.soft(await refresh(f.ownerDb, f, token, abortSignal)).toEqual({
    ok: false,
    error: "invalid_grant",
  });
  expect.soft(credentialKeys(await f.snapshot())).toEqual(credentialKeys(before));
  abortSignal.throwIfAborted();
}

async function expectIndependent(f: McpResourceFixtures, token: string, abortSignal: AbortSignal) {
  const before = await f.snapshot();
  abortSignal.throwIfAborted();
  expect(before.refresh.find((row) => row.tokenHash === sha256Base64Url(token))).toMatchObject({
    userId: f.userId,
    clientId: f.clientId,
    revokedAt: null,
  });
  const result = await refresh(f.ownerDb, f, token, abortSignal);
  expect(result.ok).toBe(true);
  assert(result.ok);
}

async function raceRefreshes(
  f: McpResourceFixtures,
  tokens: readonly [string, string],
  abortSignal: AbortSignal,
) {
  assert(h !== undefined);
  const testDb = h;
  const pools = [0, 1].map(
    () =>
      new Pool({
        connectionString: testDb.url,
        max: 1,
        connectionTimeoutMillis: 3_000,
        statement_timeout: 10_000,
        query_timeout: 15_000,
      }),
  );
  const clients: PoolClient[] = [];
  let gate: PoolClient | undefined;
  let settled: Promise<PromiseSettledResult<ExchangeResult>[]> = Promise.resolve([]);
  let primaryFailure: { error: unknown } | undefined;
  let cleanupFailure: { error: unknown } | undefined;
  let results: PromiseSettledResult<ExchangeResult>[] | undefined;
  try {
    const leftPool = pools[0];
    const rightPool = pools[1];
    assert(leftPool !== undefined && rightPool !== undefined);
    const left = await leftPool.connect();
    clients.push(left);
    const right = await rightPool.connect();
    clients.push(right);
    const [leftIdentity, rightIdentity] = await Promise.all([
      left.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"),
      right.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"),
    ]);
    const pids = [leftIdentity.rows[0]?.pid, rightIdentity.rows[0]?.pid];
    assert(pids.every((pid) => typeof pid === "number"));
    expect(new Set(pids).size).toBe(2);
    gate = await testDb.pool.connect();
    await gate.query("BEGIN");
    await gate.query("SET LOCAL statement_timeout = '5s'");
    await gate.query(
      "SELECT pg_advisory_xact_lock(hashtext('warpdrive-auth'), hashtext('mcp-grants'))",
    );
    const operations = [
      refresh(drizzle(left, { schema }), f, tokens[0], abortSignal),
      refresh(drizzle(right, { schema }), f, tokens[1], abortSignal),
    ];
    settled = Promise.allSettled(operations);
    // Observe both lock waiters so elapsed time cannot stand in for actual overlap.
    const deadline = Date.now() + 3_000;
    let observedBothWaiting = false;
    while (Date.now() < deadline) {
      abortSignal.throwIfAborted();
      const waiters = await testDb.pool.query<{ pid: number }>(
        "SELECT DISTINCT pid FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND pid = ANY($1::integer[])",
        [pids],
      );
      if (waiters.rows.length === 2) {
        observedBothWaiting = true;
        break;
      }
    }
    expect(observedBothWaiting).toBe(true);
    await gate.query("COMMIT");
    gate.release();
    gate = undefined;
    results = await settled;
  } catch (error) {
    primaryFailure = { error };
  } finally {
    try {
      if (gate !== undefined) {
        try {
          await gate.query("ROLLBACK");
        } finally {
          // Destroy this owned connection even if rollback failed, releasing its lock.
          gate.release(true);
        }
      }
    } catch (error) {
      cleanupFailure = { error };
    } finally {
      await settled;
      for (const client of clients) {
        try {
          client.release();
        } catch (error) {
          cleanupFailure ??= { error };
        }
      }
      const endings = await Promise.allSettled(pools.map((pool) => pool.end()));
      for (const ending of endings) {
        if (ending.status === "rejected") {
          cleanupFailure ??= { error: ending.reason };
        }
      }
    }
  }
  if (primaryFailure !== undefined) throw primaryFailure.error;
  if (cleanupFailure !== undefined) throw cleanupFailure.error;
  assert(results !== undefined);
  return results;
}

function fulfilled<T>(outcomes: PromiseSettledResult<T>[]) {
  return outcomes.map((outcome) => {
    expect(outcome.status).toBe("fulfilled");
    assert(outcome.status === "fulfilled");
    return outcome.value;
  });
}

const faultMarker = "refresh safety injected fault";
async function installFault(operation: "insert" | "containment", abortSignal: AbortSignal) {
  assert(h !== undefined);
  const body =
    operation === "insert"
      ? `BEGIN RAISE EXCEPTION '${faultMarker}' USING ERRCODE = 'P0001'; END;`
      : `BEGIN IF OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN RAISE EXCEPTION '${faultMarker}' USING ERRCODE = 'P0001'; END IF; RETURN NEW; END;`;
  await h.pool.query(
    `CREATE FUNCTION refresh_safety_fault() RETURNS trigger LANGUAGE plpgsql AS $$ ${body} $$`,
  );
  abortSignal.throwIfAborted();
  const event = operation === "insert" ? "INSERT" : "UPDATE OF revoked_at";
  await h.pool.query(
    `CREATE TRIGGER refresh_safety_fault BEFORE ${event} ON oauth_refresh_tokens FOR EACH ROW EXECUTE FUNCTION refresh_safety_fault()`,
  );
  abortSignal.throwIfAborted();
}

async function removeFault(abortSignal: AbortSignal) {
  assert(h !== undefined);
  await h.pool.query("DROP TRIGGER IF EXISTS refresh_safety_fault ON oauth_refresh_tokens");
  abortSignal.throwIfAborted();
  await h.pool.query("DROP FUNCTION IF EXISTS refresh_safety_fault()");
  abortSignal.throwIfAborted();
}

function postgresCause(error: unknown): unknown {
  let cause = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof cause !== "object" || cause === null) break;
    if ("code" in cause && cause.code === "P0001") return cause;
    cause = "cause" in cause ? cause.cause : undefined;
  }
  return undefined;
}

async function expectFault(
  operation: ReturnType<typeof exchangeMcpGrant>,
  abortSignal: AbortSignal,
) {
  const [outcome] = await Promise.allSettled([operation]);
  abortSignal.throwIfAborted();
  assert(outcome !== undefined);
  expect.soft(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") {
    expect(postgresCause(outcome.reason)).toMatchObject({ code: "P0001", message: faultMarker });
  }
}

test("an expired consumed root still contains its newer active descendant", async () => {
  assert(fixture !== undefined && h !== undefined);
  const f = fixture;
  const tokens = await chain(f, signal());
  await h.pool.query(
    "UPDATE oauth_refresh_tokens SET expires_at = '2000-01-01T00:00:00Z' WHERE token_hash = $1",
    [sha256Base64Url(tokens.root)],
  );
  const before = await f.snapshot();
  expect(await refresh(f.ownerDb, f, tokens.root, signal())).toEqual({
    ok: false,
    error: "invalid_grant",
  });
  expect(credentialKeys(await f.snapshot())).toEqual(credentialKeys(before));
  await expectTipDenied(f, tokens.tip, signal());
  await expectIndependent(f, tokens.independent, signal());
});

test("repeated replay preserves every row, timestamp and rotation link after containment", async () => {
  assert(fixture !== undefined);
  const f = fixture;
  const tokens = await chain(f, signal());
  expect(await refresh(f.ownerDb, f, tokens.root, signal())).toEqual({
    ok: false,
    error: "invalid_grant",
  });
  const first = await f.snapshot();
  expect
    .soft(first.refresh.find((row) => row.tokenHash === sha256Base64Url(tokens.tip))?.revokedAt)
    .toBeInstanceOf(Date);
  for (const replay of [tokens.root, tokens.intermediate]) {
    expect(await refresh(f.ownerDb, f, replay, signal())).toEqual({
      ok: false,
      error: "invalid_grant",
    });
    expect(await f.snapshot()).toEqual(first);
  }
  await expectTipDenied(f, tokens.tip, signal());
  await expectIndependent(f, tokens.independent, signal());
});

test("concurrent same-root rotations serialize and contain the returned refresh token", async () => {
  assert(fixture !== undefined);
  const f = fixture;
  const other = await independent(f, signal());
  const results = fulfilled(await raceRefreshes(f, [f.refreshToken, f.refreshToken], signal()));
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toHaveLength(1);
  for (const result of results) {
    if (!result.ok) expect(result).toEqual({ ok: false, error: "invalid_grant" });
  }
  const winner = results.find((result) => result.ok);
  assert(winner?.ok);
  await expectTipDenied(f, winner.value.refresh_token, signal());
  await expectIndependent(f, other, signal());
});

test("concurrent old-root replay and descendant rotation leave no usable affected tip", async () => {
  assert(fixture !== undefined);
  const f = fixture;
  const tokens = await chain(f, signal());
  const results = fulfilled(await raceRefreshes(f, [tokens.root, tokens.tip], signal()));
  const replay = results[0];
  const rotation = results[1];
  assert(replay !== undefined && rotation !== undefined);
  expect(replay).toEqual({ ok: false, error: "invalid_grant" });
  if (!rotation.ok) expect(rotation).toEqual({ ok: false, error: "invalid_grant" });
  const after = await f.snapshot();
  const independentHash = sha256Base64Url(tokens.independent);
  expect
    .soft(
      after.refresh
        .filter((row) => row.tokenHash !== independentHash)
        .every((row) => row.revokedAt !== null),
    )
    .toBe(true);
  await expectTipDenied(f, rotation.ok ? rotation.value.refresh_token : tokens.tip, signal());
  await expectIndependent(f, tokens.independent, signal());
});

test("successor insertion failure rolls back the original claim and all credential stores", async () => {
  assert(fixture !== undefined);
  const f = fixture;
  const other = await independent(f, signal());
  const before = await f.snapshot();
  await installFault("insert", signal());
  try {
    const abortSignal = signal();
    await expectFault(refresh(f.ownerDb, f, f.refreshToken, abortSignal), abortSignal);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    await removeFault(signal());
  }
  const original = await refresh(f.ownerDb, f, f.refreshToken, signal());
  expect(original.ok).toBe(true);
  assert(original.ok);
  await expectIndependent(f, other, signal());
});

test("containment update failure is surfaced and rolls back before the tip is used", async () => {
  assert(fixture !== undefined);
  const f = fixture;
  const tokens = await chain(f, signal());
  const before = await f.snapshot();
  await installFault("containment", signal());
  try {
    const abortSignal = signal();
    await expectFault(refresh(f.ownerDb, f, tokens.root, abortSignal), abortSignal);
    expect(await f.snapshot()).toEqual(before);
  } finally {
    await removeFault(signal());
  }
  const tip = await refresh(f.ownerDb, f, tokens.tip, signal());
  expect(tip.ok).toBe(true);
  assert(tip.ok);
  await expectIndependent(f, tokens.independent, signal());
});

test("a pre-aborted exchange preserves the exact abort reason and every credential row", async () => {
  assert(fixture !== undefined);
  const f = fixture;
  const other = await independent(f, signal());
  const before = await f.snapshot();
  const reason = Object.freeze({ test: "refresh-family-pre-abort" });
  const controller = new AbortController();
  controller.abort(reason);
  await expect(refresh(f.ownerDb, f, f.refreshToken, controller.signal)).rejects.toBe(reason);
  expect(await f.snapshot()).toEqual(before);
  const original = await refresh(f.ownerDb, f, f.refreshToken, signal());
  expect(original.ok).toBe(true);
  assert(original.ok);
  await expectIndependent(f, other, signal());
});
