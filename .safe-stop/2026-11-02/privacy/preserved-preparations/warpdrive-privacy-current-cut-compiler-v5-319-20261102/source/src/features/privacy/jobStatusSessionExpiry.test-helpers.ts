import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";
import type { createDiscoveryJobStatusReader } from "./jobStatus";

type ReadStatus = ReturnType<typeof createDiscoveryJobStatusReader>;
export type StatusExpiryOutcome =
  | { kind: "resolved"; value: Awaited<ReturnType<ReadStatus>> }
  | { kind: "rejected"; reason: unknown };
export type StatusExpiryBackend = { pid: number; backendStart: string };
type WaitWitness = StatusExpiryBackend & {
  active: boolean;
  transactionOpen: boolean;
  waiting: boolean;
  blockedByHolder: boolean;
  waitingJobLock: boolean;
  blockerHeld: boolean;
  sessionActive: boolean;
  sessionExpired: boolean;
  sessionExpiresAt: string;
};

async function observeWait(
  observer: PoolClient,
  applicationName: string,
  blockerPid: number,
  sessionId: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const result = await observer
    .query<WaitWitness>(
      `SELECT a.pid, a.backend_start::text AS "backendStart", a.state='active' AS active,
      a.xact_start IS NOT NULL AS "transactionOpen", a.wait_event_type='Lock' AS waiting,
      $2=ANY(pg_blocking_pids(a.pid)) AS "blockedByHolder",
      EXISTS (SELECT 1 FROM pg_locks WHERE pid=a.pid AND relation='privacy_jobs'::regclass
        AND mode='AccessShareLock' AND NOT granted) AS "waitingJobLock",
      EXISTS (SELECT 1 FROM pg_locks WHERE pid=$2 AND relation='privacy_jobs'::regclass
        AND mode='AccessExclusiveLock' AND granted) AS "blockerHeld",
      clock_timestamp()<s.expires_at AS "sessionActive",
      clock_timestamp()>=s.expires_at+interval '50 milliseconds' AS "sessionExpired",
      s.expires_at::text AS "sessionExpiresAt"
    FROM pg_stat_activity a JOIN sessions s ON s.id=$3
    WHERE a.datname=current_database() AND a.application_name=$1
      AND a.query LIKE '%privacy_jobs%'`,
      [applicationName, blockerPid, sessionId],
    )
    .catch((cause: unknown) => {
      throw new AggregateError([cause], "OBSERVATION: native status/session metadata query failed");
    });
  signal.throwIfAborted();
  assert(result.rows.length <= 1, "SETUP/IDENTITY: ambiguous native status reader");
  return result.rows[0];
}

function held(witness: WaitWitness): boolean {
  return (
    witness.active &&
    witness.transactionOpen &&
    witness.waiting &&
    witness.blockedByHolder &&
    witness.waitingJobLock &&
    witness.blockerHeld
  );
}

async function whileReading<Value>(
  outcome: Promise<StatusExpiryOutcome>,
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

export function waitForStatusExpiryBarrier(
  observer: PoolClient,
  applicationName: string,
  blockerPid: number,
  sessionId: string,
  outcome: Promise<StatusExpiryOutcome>,
  signal: AbortSignal,
) {
  return whileReading(outcome, signal, async (watching) => {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const witness = await observeWait(observer, applicationName, blockerPid, sessionId, watching);
      if (witness !== undefined && held(witness)) return { kind: "waiting" as const, witness };
      await delay(10, undefined, { signal: watching });
    }
    return { kind: "setup_deadline" as const };
  });
}

export function waitForHeldStatusSessionExpiry(
  observer: PoolClient,
  applicationName: string,
  blockerPid: number,
  sessionId: string,
  backend: StatusExpiryBackend,
  expiresAt: string,
  outcome: Promise<StatusExpiryOutcome>,
  signal: AbortSignal,
) {
  return whileReading(outcome, signal, async (watching) => {
    const deadline = performance.now() + 4000;
    while (performance.now() < deadline) {
      const witness = await observeWait(observer, applicationName, blockerPid, sessionId, watching);
      if (
        witness === undefined ||
        witness.pid !== backend.pid ||
        witness.backendStart !== backend.backendStart ||
        !held(witness)
      )
        return { kind: "barrier_lost" as const };
      assert.equal(witness.sessionExpiresAt, expiresAt, "SETUP: native session expiry changed");
      if (witness.sessionExpired) return { kind: "expired" as const, witness };
      await delay(20, undefined, { signal: watching });
    }
    return { kind: "observation_deadline" as const };
  });
}

export async function statusExpirySnapshot(observer: PoolClient, signal: AbortSignal) {
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

export async function finishStatusExpiry(
  blocker: PoolClient | undefined,
  observer: PoolClient | undefined,
  readerPool: Pool,
  controlPool: Pool,
  cancellationPool: Pool,
  outcome: Promise<StatusExpiryOutcome> | undefined,
  verify: () => Promise<void>,
): Promise<unknown[]> {
  const cleanup = (async () => {
    const failures: unknown[] = [];
    const retain = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    await retain(async () => {
      if (blocker === undefined) return;
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release(true);
      }
    });
    // The read is already converted to an exact settled outcome, so a rejection is drained once.
    await retain(async () => {
      await outcome;
    });
    await retain(verify);
    try {
      observer?.release(true);
    } catch (error) {
      failures.push(error);
    }
    await Promise.all([
      retain(() => readerPool.end()),
      retain(() => controlPool.end()),
      retain(() => cancellationPool.end()),
    ]);
    return failures;
  })();
  const result = await Promise.race([
    cleanup.then(
      (failures) => ({ kind: "settled" as const, failures }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    ),
    delay(12_000, { kind: "deadline" } as const, { ref: false }),
  ]);
  if (result.kind === "settled") return result.failures;
  if (result.kind === "rejected") return [result.error];
  try {
    assert.fail("CLEANUP/DEADLINE: twelve seconds elapsed; owned native cleanup not proved");
  } catch (error) {
    return [error];
  }
}
