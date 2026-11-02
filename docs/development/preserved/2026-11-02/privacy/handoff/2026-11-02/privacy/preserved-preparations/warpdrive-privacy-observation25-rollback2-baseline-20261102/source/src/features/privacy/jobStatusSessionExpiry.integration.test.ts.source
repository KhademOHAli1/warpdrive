import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import { createDiscoveryJobStatusReader } from "./jobStatus";
import {
  finishStatusExpiry,
  type StatusExpiryOutcome,
  statusExpirySnapshot,
  waitForHeldStatusSessionExpiry,
  waitForStatusExpiryBarrier,
} from "./jobStatusSessionExpiry.test-helpers";
import { enqueueDiscoveryJob } from "./jobs";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
}, 20_000);
afterAll(async () => {
  await h.close();
}, 15_000);

test("C03: session expiry during the actual job-table wait denies the status observation", async ({
  signal,
}) => {
  // Synthetic native-assurance rows are not a browser authentication qualification.
  const fixture = await authorityFixture(h, ["case.review"]);
  signal.throwIfAborted();
  const queued = await enqueueDiscoveryJob(
    h.db,
    fixture.actor,
    {
      caseId: fixture.privacyCase.id,
      expectedScopeVersion: 1,
      idempotencyKey: randomUUID(),
    },
    signal,
  );
  assert(queued.ok, "SETUP: synthetic discovery job did not queue");
  const applicationName = `privacy-status-expiry-${randomUUID()}`;
  const readerPool = new Pool({
    connectionString: h.url,
    application_name: applicationName,
    max: 1,
    connectionTimeoutMillis: 1000,
    statement_timeout: 8000,
    pipeline: false,
  });
  const controlPool = new Pool({
    connectionString: h.url,
    max: 2,
    connectionTimeoutMillis: 1000,
    statement_timeout: 1000,
    pipeline: false,
  });
  // Cancellation owns a separate max-one pool; the max-two pool holds the blocker and observer.
  const cancellationPool = new Pool({
    connectionString: h.url,
    max: 1,
    connectionTimeoutMillis: 100,
    statement_timeout: 100,
    query_timeout: 100,
    pipeline: false,
  });
  const readStatus = createDiscoveryJobStatusReader(readerPool, cancellationPool);
  let blocker: PoolClient | undefined;
  let observer: PoolClient | undefined;
  let outcome: Promise<StatusExpiryOutcome> | undefined;
  let before: unknown;
  let primary: { error: unknown } | undefined;
  let cleanupFailures: unknown[] = [];
  try {
    blocker = await controlPool.connect();
    observer = await controlPool.connect();
    before = await statusExpirySnapshot(observer, signal);
    await blocker.query("BEGIN");
    await blocker.query(
      "SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='12s'",
    );
    // A row lock cannot block this reader's plain SELECT.
    await blocker.query("LOCK TABLE privacy_jobs IN ACCESS EXCLUSIVE MODE");
    const holder = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const blockerPid = holder.rows[0]?.pid;
    assert(blockerPid !== undefined, "SETUP: missing exact job-table holder PID");
    const expiry = await observer.query<{ expiresAt: string }>(
      `UPDATE sessions SET expires_at=clock_timestamp()+interval '3 seconds'
       WHERE id=$1 RETURNING expires_at::text AS "expiresAt"`,
      [fixture.session.id],
    );
    signal.throwIfAborted();
    const expiresAt = expiry.rows[0]?.expiresAt;
    assert(
      expiry.rows.length === 1 && expiresAt !== undefined,
      "SETUP: session expiry was not set",
    );
    outcome = readStatus(
      fixture.actor,
      { caseId: fixture.privacyCase.id, jobId: queued.value.id },
      AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    ).then(
      (value) => ({ kind: "resolved" as const, value }),
      (reason: unknown) => ({ kind: "rejected" as const, reason }),
    );
    const barrier = await waitForStatusExpiryBarrier(
      observer,
      applicationName,
      blockerPid,
      fixture.session.id,
      outcome,
      signal,
    );
    assert(
      barrier.kind !== "setup_deadline",
      "SETUP/DEADLINE: no native job-table wait within two seconds",
    );
    assert(
      barrier.kind === "waiting",
      "BEHAVIOR: reader settled before its native job-table barrier",
    );
    assert(barrier.witness.pid !== blockerPid, "SETUP/IDENTITY: reader and holder must differ");
    assert.equal(
      barrier.witness.sessionExpiresAt,
      expiresAt,
      "SETUP: observed expiry must match native setup",
    );
    assert(
      barrier.witness.sessionActive,
      "SETUP/TIMING: session expired before the actual reader wait",
    );
    const expired = await waitForHeldStatusSessionExpiry(
      observer,
      applicationName,
      blockerPid,
      fixture.session.id,
      { pid: barrier.witness.pid, backendStart: barrier.witness.backendStart },
      expiresAt,
      outcome,
      signal,
    );
    assert(
      expired.kind !== "observation_deadline",
      "OBSERVATION/DEADLINE: native session expiry was not witnessed",
    );
    assert(
      expired.kind === "expired",
      "BEHAVIOR: original reader must remain at the held barrier through native expiry",
    );
    expect(
      expired.witness.sessionActive,
      "SETUP: expiry must be observed before holder release",
    ).toBe(false);
    await blocker.query("ROLLBACK");
    const result = await Promise.race([
      outcome,
      delay(2000, { kind: "completion_deadline" } as const, { ref: false }),
    ]);
    assert(
      result.kind !== "completion_deadline",
      "OBSERVATION/DEADLINE: reader did not settle after holder release",
    );
    expect(result, "BEHAVIOR: an expired current session must not receive job status").toEqual({
      kind: "resolved",
      value: { ok: false, error: "forbidden" },
    });
  } catch (error) {
    primary = { error };
  } finally {
    cleanupFailures = await finishStatusExpiry(
      blocker,
      observer,
      readerPool,
      controlPool,
      cancellationPool,
      outcome,
      async () => {
        if (before !== undefined && observer !== undefined)
          expect(
            await statusExpirySnapshot(observer, AbortSignal.timeout(1500)),
            "STATE: status observation must preserve cases, proofs, events and jobs",
          ).toEqual(before);
      },
    );
  }
  if (primary !== undefined && cleanupFailures.length > 0)
    throw new AggregateError(
      [primary.error, ...cleanupFailures],
      "Status expiry assertion and native cleanup/state controls failed",
    );
  if (primary !== undefined) throw primary.error;
  if (cleanupFailures.length > 0)
    throw new AggregateError(cleanupFailures, "CLEANUP/STATE: owned status expiry controls failed");
}, 30_000);
