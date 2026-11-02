import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { expect } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import type { TestDb } from "@/test/db";
import type { Result } from "@/types/result";

async function statusExpirySnapshot(observer: PoolClient, signal: AbortSignal) {
  signal.throwIfAborted();
  const result = await observer.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'cases', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_cases t),
    'proofs', (SELECT jsonb_agg(t ORDER BY case_id) FROM privacy_case_verifications t),
    'events', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_case_events t),
    'jobs', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_jobs t)
  ) AS state`);
  signal.throwIfAborted();
  assert(result.rows[0] !== undefined, "STATE: missing native durable-state snapshot");
  return result.rows[0].state;
}

type Outcome =
  | { kind: "resolved"; value: Result<unknown, unknown> }
  | { kind: "rejected"; reason: unknown };
type Target = {
  relation: "privacy_jobs" | "privacy_case_events" | "privacy_case_verifications";
  mode: "AccessShareLock" | "RowExclusiveLock";
  queryPattern: string;
  caseWriteBeforeWait: boolean;
};
type Identity = { pid: number; backendStart: string };
type Expiry = { expiresAt: string; expiresEpochMs: string };
type Witness = Identity &
  Expiry & {
    active: boolean;
    transactionOpen: boolean;
    waiting: boolean;
    blockedByHolder: boolean;
    waitingTargetLock: boolean;
    blockerHeld: boolean;
    blockerIdentityMatches: boolean;
    sessionLockHeld: boolean;
    caseWriteHeld: boolean;
    sessionActive: boolean;
    sessionExpired: boolean;
  };
const held = (row: Witness) =>
  row.active &&
  row.transactionOpen &&
  row.waiting &&
  row.blockedByHolder &&
  row.waitingTargetLock &&
  row.blockerHeld &&
  row.blockerIdentityMatches &&
  row.sessionLockHeld;

async function observe(
  observer: PoolClient,
  applicationName: string,
  holder: Identity,
  sessionId: string,
  target: Target,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const result = await observer.query<Witness>(
    `SELECT a.pid,a.backend_start::text AS "backendStart",a.state='active' AS active,
    a.xact_start IS NOT NULL AS "transactionOpen",a.wait_event_type='Lock' AS waiting,
    $2=ANY(pg_blocking_pids(a.pid)) AS "blockedByHolder",
    EXISTS(SELECT 1 FROM pg_locks WHERE pid=a.pid AND relation=$4::regclass
      AND mode=$5 AND NOT granted) AS "waitingTargetLock",
    EXISTS(SELECT 1 FROM pg_locks WHERE pid=$2 AND relation=$4::regclass
      AND mode='AccessExclusiveLock' AND granted) AS "blockerHeld",
    COALESCE(b.backend_start::text=$7,false) AS "blockerIdentityMatches",
    EXISTS(SELECT 1 FROM pg_locks WHERE pid=a.pid AND relation='sessions'::regclass
      AND mode='RowShareLock' AND granted) AS "sessionLockHeld",
    EXISTS(SELECT 1 FROM pg_locks WHERE pid=a.pid AND relation='privacy_cases'::regclass
      AND mode='RowExclusiveLock' AND granted) AS "caseWriteHeld",
    clock_timestamp()<s.expires_at AS "sessionActive",
    clock_timestamp()>=s.expires_at+interval '50 milliseconds' AS "sessionExpired",
    s.expires_at::text AS "expiresAt",
    ceil(extract(epoch FROM s.expires_at)*1000)::bigint::text AS "expiresEpochMs"
    FROM pg_stat_activity a JOIN sessions s ON s.id=$3
    LEFT JOIN pg_stat_activity b ON b.pid=$2
    WHERE a.datname=current_database() AND a.application_name=$1 AND a.query ILIKE $6`,
    [
      applicationName,
      holder.pid,
      sessionId,
      target.relation,
      target.mode,
      target.queryPattern,
      holder.backendStart,
    ],
  );
  signal.throwIfAborted();
  assert(result.rows.length <= 1, "SETUP/IDENTITY: ambiguous completion-expiry backend");
  return result.rows[0];
}

async function raceObservation<Value>(
  outcome: Promise<Outcome>,
  signal: AbortSignal,
  poll: (watching: AbortSignal) => Promise<Value>,
) {
  const stop = new AbortController();
  const pending = poll(AbortSignal.any([signal, stop.signal]));
  try {
    return await Promise.race([
      pending,
      outcome.then((value) => ({ kind: "settled" as const, outcome: value })),
    ]);
  } finally {
    stop.abort();
    await Promise.allSettled([pending]);
  }
}

async function firstWait(
  outcome: Promise<Outcome>,
  signal: AbortSignal,
  read: (watching: AbortSignal) => Promise<Witness | undefined>,
) {
  return raceObservation(outcome, signal, async (watching) => {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const witness = await read(watching);
      if (witness !== undefined && held(witness)) return { kind: "waiting" as const, witness };
      // Poll spacing is never success; only the actual native witness can satisfy the barrier.
      await delay(10, undefined, { signal: watching });
    }
    return { kind: "setup_deadline" as const };
  });
}

async function heldThroughExpiry(
  outcome: Promise<Outcome>,
  signal: AbortSignal,
  original: Witness,
  read: (watching: AbortSignal) => Promise<Witness | undefined>,
) {
  return raceObservation(outcome, signal, async (watching) => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const witness = await read(watching);
      if (
        witness === undefined ||
        !held(witness) ||
        witness.pid !== original.pid ||
        witness.backendStart !== original.backendStart
      )
        return { kind: "barrier_lost" as const };
      assert.equal(witness.expiresAt, original.expiresAt, "SETUP: native expiry changed");
      assert.equal(
        witness.expiresEpochMs,
        original.expiresEpochMs,
        "SETUP: native expiry epoch changed",
      );
      assert(/^\d+$/u.test(witness.expiresEpochMs), "SETUP: invalid native expiry milliseconds");
      // Compare clocks only. Never replace native identity timestamps with Date/Number parsing.
      if (witness.sessionExpired && BigInt(Date.now()) >= BigInt(witness.expiresEpochMs))
        return { kind: "expired" as const, witness };
      await delay(20, undefined, { signal: watching });
    }
    return { kind: "observation_deadline" as const };
  });
}

export async function exerciseCompletionExpiry(
  h: TestDb,
  sessionId: string,
  target: Target,
  signal: AbortSignal,
  operation: (db: Db, signal: AbortSignal) => Promise<Result<unknown, unknown>>,
  atFirstWait: () => void = () => undefined,
) {
  const applicationName = `privacy-expiry-${randomUUID()}`;
  assert(Buffer.byteLength(applicationName) < 63, "SETUP: application name must not truncate");
  const mutationPool = new Pool({
    connectionString: h.url,
    application_name: applicationName,
    max: 1,
    pipeline: false,
    connectionTimeoutMillis: 1000,
    statement_timeout: 10_000,
    query_timeout: 12_000,
  });
  const witnessPool = new Pool({
    connectionString: h.url,
    max: 2,
    pipeline: false,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
    query_timeout: 1500,
  });
  let blocker: PoolClient | undefined;
  let observer: PoolClient | undefined;
  let outcome: Promise<Outcome> | undefined;
  let before: unknown;
  let primary: { error: unknown } | undefined;
  const cleanupFailures: unknown[] = [];
  const releaseBlocker = async () => {
    const owned = blocker;
    blocker = undefined;
    if (owned === undefined) return;
    try {
      await owned.query("ROLLBACK");
    } finally {
      owned.release(true);
    }
  };
  try {
    blocker = await witnessPool.connect();
    observer = await witnessPool.connect();
    const observing = observer;
    before = await statusExpirySnapshot(observer, signal);
    await blocker.query("BEGIN");
    await blocker.query(
      "SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='12s'",
    );
    // relation is a closed test-owned union, never caller input.
    await blocker.query(`LOCK TABLE ${target.relation} IN ACCESS EXCLUSIVE MODE`);
    const holder = (
      await blocker.query<Identity>(
        `SELECT pg_backend_pid() AS pid,
      (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS "backendStart"`,
      )
    ).rows[0];
    assert(holder !== undefined, "SETUP: missing exact blocker identity");
    const expiry = (
      await observer.query<Expiry>(
        `UPDATE sessions SET expires_at=clock_timestamp()+interval '3 seconds' WHERE id=$1
      RETURNING expires_at::text AS "expiresAt",
      ceil(extract(epoch FROM expires_at)*1000)::bigint::text AS "expiresEpochMs"`,
        [sessionId],
      )
    ).rows[0];
    assert(expiry !== undefined, "SETUP: missing native session expiry");
    signal.throwIfAborted();
    const operationSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    outcome = operation(drizzle(mutationPool, { schema }), operationSignal).then(
      (value) => ({ kind: "resolved" as const, value }),
      (reason: unknown) => ({ kind: "rejected" as const, reason }),
    );
    const read = (watching: AbortSignal) =>
      observe(observing, applicationName, holder, sessionId, target, watching);
    const first = await firstWait(outcome, signal, read);
    assert(
      first.kind !== "setup_deadline",
      "SETUP/TIMING: native target-table barrier not observed",
    );
    assert(
      first.kind === "waiting",
      "SETUP/PRECONDITION: operation settled before the native barrier",
    );
    expect(first.witness.pid).not.toBe(holder.pid);
    expect(first.witness.expiresAt).toBe(expiry.expiresAt);
    expect(first.witness.expiresEpochMs).toBe(expiry.expiresEpochMs);
    expect(
      first.witness.sessionActive,
      "SETUP/TIMING: session must still be valid at entry wait",
    ).toBe(true);
    expect(first.witness.caseWriteHeld).toBe(target.caseWriteBeforeWait);
    atFirstWait();
    const expired = await heldThroughExpiry(outcome, signal, first.witness, read);
    assert(
      expired.kind !== "observation_deadline",
      "OBSERVATION/CLOCK: held native/app expiry was not witnessed",
    );
    assert(
      expired.kind === "expired",
      "OBSERVATION/BARRIER: same native transaction must remain held through expiry",
    );
    expect(expired.witness.sessionActive).toBe(false);
    expect(BigInt(Date.now()) >= BigInt(expired.witness.expiresEpochMs)).toBe(true);
    await releaseBlocker();
    const result = await Promise.race([
      outcome,
      delay(2000, { kind: "completion_deadline" } as const, { ref: false }),
    ]);
    assert(
      result.kind !== "completion_deadline",
      "OBSERVATION: operation did not settle after release",
    );
    expect(result).toEqual({ kind: "resolved", value: { ok: false, error: "forbidden" } });
  } catch (error) {
    primary = { error };
  } finally {
    const retain = async (effect: () => Promise<unknown>) => {
      try {
        await effect();
      } catch (error) {
        cleanupFailures.push(error);
      }
    };
    const cleanup = (async () => {
      // Release our barrier FIRST, then drain the exact settled domain outcome before observing rows.
      await retain(releaseBlocker);
      await retain(async () => {
        await outcome;
      });
      await retain(async () => {
        if (before !== undefined && observer !== undefined)
          expect(
            await statusExpirySnapshot(observer, AbortSignal.timeout(1500)),
            "STATE: expired completion must preserve all durable cases/proofs/events/jobs",
          ).toEqual(before);
      });
      try {
        observer?.release(true);
      } catch (error) {
        cleanupFailures.push(error);
      }
      await Promise.all([retain(() => mutationPool.end()), retain(() => witnessPool.end())]);
    })();
    const cleaned = await Promise.race([
      cleanup.then(() => true),
      delay(12_000, false, { ref: false }),
    ]);
    if (!cleaned)
      cleanupFailures.push(
        new Error("CLEANUP/DEADLINE: owned expiry resources not proved closed within12s"),
      );
  }
  const failures = [...(primary === undefined ? [] : [primary.error]), ...cleanupFailures];
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Completion expiry behavior/state/cleanup failed");
}
