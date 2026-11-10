import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool } from "pg";
import type { TestDb } from "@/test/db";
import type { loadPrivacyNativeSubjectReview } from "./nativeSubjectReview";
import type { SubjectReviewFixture } from "./nativeSubjectReview.test-helpers";

type Review = Awaited<ReturnType<typeof loadPrivacyNativeSubjectReview>>;
export type ReviewOutcome =
  | { status: "resolved"; value: Review }
  | { status: "rejected"; reason: unknown };
export const observeSubjectReview = (pending: Promise<Review>): Promise<ReviewOutcome> =>
  pending.then(
    (value) => ({ status: "resolved", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );

export async function holdContactSource(h: TestDb, contactId: string, grow = false) {
  const client = await h.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='12s'",
    );
    await client.query("SELECT id FROM persons WHERE id=$1 FOR UPDATE", [contactId]);
    if (grow)
      await client.query("UPDATE persons SET first_name=repeat('x',1048577) WHERE id=$1", [
        contactId,
      ]);
    const identity = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const pid = identity.rows[0]?.pid;
    assert(pid !== undefined, "SETUP: missing exact source-holder backend");
    let finishing: Promise<void> | undefined;
    return {
      pid,
      finish(command: "COMMIT" | "ROLLBACK") {
        finishing ??= client
          .query(command)
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
export type HeldContactSource = Awaited<ReturnType<typeof holdContactSource>>;

export async function observeSourceWaitOrOutcome(
  h: TestDb,
  applicationName: string,
  holder: number,
  outcome: Promise<ReviewOutcome>,
  signal: AbortSignal,
) {
  const stop = new AbortController();
  const watching = AbortSignal.any([signal, stop.signal]);
  const poll = (async () => {
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      watching.throwIfAborted();
      const waiting = await h.pool.query<{ pid: number }>(
        `SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND application_name=$1 AND state='active'
          AND wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid))
          AND query ILIKE '%persons%'`,
        [applicationName, holder],
      );
      watching.throwIfAborted();
      assert(waiting.rows.length <= 1, "SETUP: ambiguous native subject reader identity");
      const reader = waiting.rows[0];
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

export async function durableSubjectReviewSnapshot(h: TestDb, f: SubjectReviewFixture) {
  const result = await h.pool.query<{ state: unknown }>(
    `SELECT jsonb_build_object(
    'case', (SELECT to_jsonb(t) FROM privacy_cases t WHERE id=$1),
    'proof', (SELECT to_jsonb(t) FROM privacy_case_verifications t WHERE case_id=$1),
    'events', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_case_events t WHERE case_id=$1),
    'jobs', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_jobs t WHERE case_id=$1)
  ) AS state`,
    [f.privacyCase.id],
  );
  assert(result.rows[0] !== undefined, "SETUP: missing native review snapshot");
  return result.rows[0].state;
}

export async function waitForNativeSessionExpiry(
  h: TestDb,
  sessionId: string,
  signal: AbortSignal,
) {
  const deadline = performance.now() + 6000;
  while (performance.now() < deadline) {
    signal.throwIfAborted();
    const time = await h.pool.query<{ expired: boolean }>(
      "SELECT clock_timestamp()>=expires_at AS expired FROM sessions WHERE id=$1",
      [sessionId],
    );
    signal.throwIfAborted();
    if (time.rows[0]?.expired === true) return;
    await delay(25, undefined, { signal });
  }
  assert.fail(
    "SETUP/TIMING: native session did not expire within the six-second observation window",
  );
}

export async function finishSourceReviewBarrier(
  source: HeldContactSource,
  outcome: Promise<ReviewOutcome> | undefined,
  pool: Pool,
) {
  const cleanup = (async () => {
    try {
      await source.finish("ROLLBACK");
      await outcome;
    } finally {
      await pool.end();
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
    "CLEANUP: eight-second observation deadline; native cleanup is not proved",
  );
}
