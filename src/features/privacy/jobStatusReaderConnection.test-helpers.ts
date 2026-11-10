import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolConfig } from "pg";
import type { TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import type { createDiscoveryJobStatusReader } from "./jobStatus";
import { enqueueDiscoveryJob } from "./jobs";

type Reader = ReturnType<typeof createDiscoveryJobStatusReader>;
type Status = Extract<Awaited<ReturnType<Reader>>, { ok: true }>["value"];
export type ReaderOutcome =
  | { kind: "resolved"; value: Awaited<ReturnType<Reader>> }
  | { kind: "rejected"; reason: unknown };

// Same existing native authority/queued-job fixture path; no manually invented job/session rows.
export async function queuedReaderFixture(h: TestDb, signal: AbortSignal) {
  signal.throwIfAborted();
  const original = await authorityFixture(h, ["case.review"]);
  signal.throwIfAborted();
  const created = await enqueueDiscoveryJob(
    h.db,
    original.actor,
    {
      caseId: original.privacyCase.id,
      expectedScopeVersion: 1,
      idempotencyKey: randomUUID(),
    },
    signal,
  );
  assert(created.ok, "SETUP: existing native queued-status fixture did not queue");
  return {
    actor: original.actor,
    input: { caseId: original.privacyCase.id, jobId: created.value.id },
  };
}
export type ReaderFixture = Awaited<ReturnType<typeof queuedReaderFixture>>;

export async function nativeExpectedStatus(
  observer: Pool,
  fixture: ReaderFixture,
): Promise<Status> {
  const result = await observer.query<Status>(
    `SELECT id,case_id AS "caseId",kind,status,attempts,
    updated_at AS "updatedAt" FROM privacy_jobs WHERE id=$1 AND case_id=$2`,
    [fixture.input.jobId, fixture.input.caseId],
  );
  const row = result.rows[0];
  assert(
    result.rows.length === 1 && row !== undefined,
    "SETUP: missing exact native queued-status row",
  );
  return row;
}

async function protectedRows(observer: Pool, fixture: ReaderFixture) {
  const result = await observer.query<{ state: unknown }>(
    `SELECT jsonb_build_object(
    'case',(SELECT to_jsonb(t) FROM privacy_cases t WHERE id=$1),
    'proof',(SELECT to_jsonb(t) FROM privacy_case_verifications t WHERE case_id=$1),
    'events',(SELECT jsonb_agg(t ORDER BY id) FROM privacy_case_events t WHERE case_id=$1),
    'jobs',(SELECT jsonb_agg(t ORDER BY id) FROM privacy_jobs t WHERE case_id=$1)
  ) AS state`,
    [fixture.input.caseId],
  );
  assert(result.rows[0] !== undefined, "SETUP: missing native protected-row observation");
  return result.rows[0].state;
}

export async function observeUntil(
  condition: () => boolean | Promise<boolean>,
  milliseconds: number,
  signal: AbortSignal,
): Promise<boolean> {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) {
    signal.throwIfAborted();
    if (await condition()) return true;
    // Poll spacing is never a success criterion; only the actual native/public observation is.
    await delay(5, undefined, { signal });
  }
  return false;
}

export async function observeQueuedCheckout(
  pool: Pool,
  outcome: Promise<ReaderOutcome>,
  signal: AbortSignal,
) {
  const stop = new AbortController();
  const polling = observeUntil(
    () => pool.waitingCount === 1,
    1000,
    AbortSignal.any([signal, stop.signal]),
  );
  try {
    return await Promise.race([
      polling.then((waiting) => (waiting ? ("waiting" as const) : ("setup_deadline" as const))),
      outcome.then(() => "settled" as const),
    ]);
  } finally {
    stop.abort();
    await Promise.allSettled([polling]);
  }
}

export async function withReaderPool(
  h: TestDb,
  fixture: ReaderFixture,
  options: PoolConfig,
  effect: (pool: Pool, cancellationPool: Pool, observer: Pool) => Promise<void>,
) {
  const pool = new Pool({
    connectionString: h.url,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    pipeline: false,
    ...options,
  });
  const observer = new Pool({
    connectionString: h.url,
    max: 1,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
    query_timeout: 1500,
    pipeline: false,
  });
  const cancellationPool = new Pool({
    connectionString: h.url,
    max: 1,
    connectionTimeoutMillis: 100,
    statement_timeout: 100,
    query_timeout: 100,
    pipeline: false,
  });
  let poolErrors = 0;
  pool.on("error", () => {
    poolErrors += 1;
  });
  const failures: unknown[] = [];
  let before: unknown;
  let captured = false;
  try {
    before = await protectedRows(observer, fixture);
    captured = true;
    await effect(pool, cancellationPool, observer);
  } catch (error) {
    failures.push(error);
  }
  try {
    const ended = await Promise.race([
      cancellationPool.end().then(() => true),
      delay(1000, false, { ref: false }),
    ]);
    assert(ended, "CLEANUP: owned cancellation pool did not end; ownership remains unproved");
  } catch (error) {
    failures.push(error);
  }
  try {
    const ended = await Promise.race([
      pool.end().then(() => true),
      delay(3500, false, { ref: false }),
    ]);
    assert(ended, "CLEANUP: owned observation pool did not end; ownership remains unproved");
  } catch (error) {
    failures.push(error);
  }
  try {
    if (captured)
      assert.deepEqual(
        await protectedRows(observer, fixture),
        before,
        "BEHAVIOR: native queued/case/proof/event rows changed during observation",
      );
    assert.equal(poolErrors, 0, "BEHAVIOR: unexpected error from the test-owned observation pool");
  } catch (error) {
    failures.push(error);
  }
  try {
    const ended = await Promise.race([
      observer.end().then(() => true),
      delay(2000, false, { ref: false }),
    ]);
    assert(ended, "CLEANUP: independent native observer did not end");
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 1)
    throw new AggregateError(failures, "Reader assertion/cleanup/native-state controls failed");
  if (failures.length === 1) throw failures[0];
}
