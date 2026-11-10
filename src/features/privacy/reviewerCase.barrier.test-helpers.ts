import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { TestDb } from "@/test/db";
import type { readPrivacyReviewerCase } from "./reviewerCase";

type ReadResult = Awaited<ReturnType<typeof readPrivacyReviewerCase>>;
export type ReviewerCaseOutcome =
  | { status: "resolved"; value: ReadResult }
  | { status: "rejected"; reason: unknown };
export const observeReviewerCase = (pending: Promise<ReadResult>): Promise<ReviewerCaseOutcome> =>
  pending.then(
    (value) => ({ status: "resolved", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );

export async function holdReviewerCase(h: TestDb, caseId: string) {
  const client = await h.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='12s'",
    );
    const row = await client.query<{ id: string }>(
      "SELECT id FROM privacy_cases WHERE id=$1 FOR UPDATE",
      [caseId],
    );
    assert(row.rows[0]?.id === caseId, "SETUP: exact owned case row was not locked");
    const identity = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = identity.rows[0]?.pid;
    assert(pid !== undefined, "SETUP: missing exact case-holder backend");
    let finishing: Promise<void> | undefined;
    return {
      pid,
      finish() {
        finishing ??= client
          .query("ROLLBACK")
          .then(() => undefined)
          .finally(() => client.release(true));
        return finishing;
      },
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release(true);
    }
    throw error;
  }
}
export type HeldReviewerCase = Awaited<ReturnType<typeof holdReviewerCase>>;

export async function observeReviewerCaseWait(
  h: TestDb,
  applicationName: string,
  holderPid: number,
  outcome: Promise<ReviewerCaseOutcome>,
  signal: AbortSignal,
) {
  const stop = new AbortController();
  const watching = AbortSignal.any([signal, stop.signal]);
  const poll = (async () => {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      watching.throwIfAborted();
      const rows = await h.pool.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=$1 AND state='active'
          AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))
          AND query ILIKE '%privacy_cases%'`,
        [applicationName, holderPid],
      );
      watching.throwIfAborted();
      assert(rows.rows.length <= 1, "SETUP: ambiguous native reviewer-case reader identity");
      const reader = rows.rows[0];
      if (reader !== undefined) return { kind: "waiting" as const, readerPid: reader.pid };
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

export async function waitReviewerSessionExpiry(h: TestDb, sessionId: string, signal: AbortSignal) {
  const deadline = performance.now() + 6000;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const time = await h.pool.query<{ expired: boolean }>(
      "SELECT clock_timestamp()>=expires_at+interval '50 milliseconds' AS expired FROM sessions WHERE id=$1",
      [sessionId],
    );
    signal.throwIfAborted();
    if (time.rows[0]?.expired === true) return;
    await delay(25, undefined, { signal });
  }
  assert.fail("SETUP/TIMING: native reviewer session did not expire within six seconds");
}

export async function finishReviewerCaseBarrier(
  holder: HeldReviewerCase | undefined,
  outcome: Promise<ReviewerCaseOutcome> | undefined,
  readerPool: Pool,
) {
  const cleanup = (async () => {
    try {
      await holder?.finish();
    } finally {
      try {
        await outcome;
      } finally {
        await readerPool.end();
      }
    }
  })();
  const result = await Promise.race([
    cleanup.then(
      () => ({ kind: "clean" as const }),
      (error: unknown) => ({ kind: "error" as const, error }),
    ),
    delay(8000, { kind: "deadline" } as const, { ref: false }),
  ]);
  if (result.kind === "error") throw result.error;
  assert(
    result.kind === "clean",
    "CLEANUP: eight-second deadline; owned native cleanup is not proved",
  );
}
