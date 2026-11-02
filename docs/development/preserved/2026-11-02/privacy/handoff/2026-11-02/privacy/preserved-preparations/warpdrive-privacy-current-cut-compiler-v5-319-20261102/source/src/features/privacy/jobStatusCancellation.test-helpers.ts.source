import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool, PoolClient } from "pg";

export type StatusOutcome =
  | { kind: "resolved"; value: unknown }
  | { kind: "rejected"; reason: unknown };
export type StatusBackend = { pid: number; backendStart: string };

// The observer is a separately checked-out native client, never the exhausted reader pool.
export async function waitForStatusBackend(
  observer: PoolClient,
  applicationName: string,
  blockerPid: number,
  outcome: Promise<StatusOutcome>,
  signal: AbortSignal,
) {
  const stop = new AbortController();
  const watching = AbortSignal.any([signal, stop.signal]);
  const poll = (async () => {
    const deadline = performance.now() + 2500;
    while (performance.now() < deadline) {
      watching.throwIfAborted();
      const result = await observer
        .query<StatusBackend>(
          `SELECT pid, backend_start::text AS "backendStart" FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=$1 AND state='active'
          AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))
          AND query LIKE '%privacy_jobs%'`,
          [applicationName, blockerPid],
        )
        .catch((cause: unknown) => {
          throw new AggregateError(
            [cause],
            "OBSERVATION: native status lock metadata query failed",
          );
        });
      watching.throwIfAborted();
      assert(result.rows.length <= 1, "SETUP: ambiguous native status reader identity");
      const backend = result.rows[0];
      if (backend !== undefined) return { kind: "waiting" as const, backend };
      await delay(10, undefined, { signal: watching });
    }
    return { kind: "setup_deadline" as const };
  })();
  try {
    return await Promise.race([
      poll,
      outcome.then((value) => ({ kind: "settled" as const, outcome: value })),
    ]);
  } finally {
    stop.abort();
    await Promise.allSettled([poll]);
  }
}

type BackendState = {
  blockerHeld: boolean;
  pid: number | null;
  backendStart: string | null;
  state: string | null;
  transactionOpen: boolean | null;
  hasLocks: boolean;
};

export async function confirmStatusBackendWait(
  observer: PoolClient,
  backend: StatusBackend,
  blockerPid: number,
  signal: AbortSignal,
): Promise<boolean> {
  signal.throwIfAborted();
  // SQL text preserves PostgreSQL microseconds; a JavaScript Date is not this identity.
  const result = await observer
    .query<{
      pid: number;
      backendStart: string;
      state: string;
      transactionOpen: boolean;
      waitType: string;
      blockedByHolder: boolean;
      waitingJobLock: boolean;
      blockerHeld: boolean;
    }>(
      `SELECT a.pid, a.backend_start::text AS "backendStart", a.state,
      a.xact_start IS NOT NULL AS "transactionOpen", a.wait_event_type AS "waitType",
      $2=ANY(pg_blocking_pids(a.pid)) AS "blockedByHolder",
      EXISTS (SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='privacy_jobs'::regclass
        AND NOT granted) AS "waitingJobLock",
      EXISTS (SELECT 1 FROM pg_locks WHERE pid=$2 AND relation='privacy_jobs'::regclass
        AND mode='AccessExclusiveLock' AND granted) AS "blockerHeld"
    FROM pg_stat_activity a WHERE a.pid=$1 AND a.backend_start::text=$3`,
      [backend.pid, blockerPid, backend.backendStart],
    )
    .catch((cause: unknown) => {
      throw new AggregateError([cause], "OBSERVATION: native pre-abort identity control failed");
    });
  signal.throwIfAborted();
  const row = result.rows[0];
  return (
    result.rows.length === 1 &&
    row !== undefined &&
    row.pid === backend.pid &&
    row.backendStart === backend.backendStart &&
    row.state === "active" &&
    row.transactionOpen &&
    row.waitType === "Lock" &&
    row.blockedByHolder &&
    row.waitingJobLock &&
    row.blockerHeld
  );
}

export async function observeStatusBackendRollback(
  observer: PoolClient,
  backend: StatusBackend,
  blockerPid: number,
  signal: AbortSignal,
) {
  const deadline = performance.now() + 1000;
  let last: BackendState | undefined;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const observed = await observer.query<BackendState>(
      `SELECT b.held AS "blockerHeld", a.pid, a.backend_start::text AS "backendStart",
        a.state, a.xact_start IS NOT NULL AS "transactionOpen",
        EXISTS (SELECT 1 FROM pg_locks WHERE pid=$1) AS "hasLocks"
      FROM (SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=$2
        AND relation='privacy_jobs'::regclass AND mode='AccessExclusiveLock'
        AND granted) AS held) b
      LEFT JOIN pg_stat_activity a ON a.pid=$1`,
      [backend.pid, blockerPid],
    );
    signal.throwIfAborted();
    last = observed.rows[0];
    assert(last !== undefined, "OBSERVATION: native backend-state query returned no witness");
    if (!last.blockerHeld) return { kind: "blocker_lost" as const };
    const originalAbsent = last.pid === null || last.backendStart !== backend.backendStart;
    const rolledBack = last.state === "idle" && last.transactionOpen === false && !last.hasLocks;
    if (originalAbsent || rolledBack)
      return performance.now() < deadline
        ? { kind: "acknowledged" as const, method: originalAbsent ? "absent" : "rolled_back" }
        : { kind: "observation_deadline" as const };
    await delay(10, undefined, { signal });
  }
  // An affirmative old-backend witness differs from inability to observe its state.
  return last === undefined
    ? { kind: "observation_deadline" as const }
    : { kind: "backend_lingering" as const, last };
}

export function retainAssertion(failures: unknown[], assertion: () => void): void {
  try {
    assertion();
  } catch (error) {
    failures.push(error);
  }
}

export async function boundedStatusCleanup(operation: () => Promise<void>): Promise<unknown[]> {
  const result = await Promise.race([
    operation().then(
      () => ({ kind: "clean" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    delay(8000, { kind: "deadline" } as const, { ref: false }),
  ]);
  if (result.kind === "error") return [result.error];
  if (result.kind === "deadline") {
    try {
      assert.fail("CLEANUP: eight-second observation deadline; native cleanup not proved");
    } catch (error) {
      return [error];
    }
  }
  return [];
}

export async function finishStatusCancellation(
  blocker: PoolClient | undefined,
  observer: PoolClient | undefined,
  readerPool: Pool,
  controlPool: Pool,
  readOutcome: Promise<StatusOutcome> | undefined,
  recovery: Promise<unknown> | undefined,
  verify: () => Promise<void>,
) {
  return boundedStatusCleanup(async () => {
    const failures: unknown[] = [];
    const retain = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        failures.push(error);
      }
    };
    try {
      await retain(async () => {
        if (blocker === undefined) return;
        try {
          await blocker.query("ROLLBACK");
        } finally {
          blocker.release(true);
        }
      });
      await retain(async () => {
        await readOutcome;
      });
      // Recovery is an already-labeled resolved outcome, so draining it is not another failure.
      await retain(async () => {
        await recovery;
      });
      await retain(verify);
    } finally {
      try {
        observer?.release(true);
      } catch (error) {
        failures.push(error);
      }
      await retain(() => readerPool.end());
      await retain(() => controlPool.end());
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        "CLEANUP: owned status clients or recovery controls failed",
      );
  });
}
