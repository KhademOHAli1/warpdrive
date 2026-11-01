import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as schema from "@/db/schema";
import {
  privacyCaseMembers,
  privacyCases,
  privacyCaseVerifications,
  privacyJobs,
  sessions,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import { getDiscoveryJobStatus } from "./jobStatus";
import { claimDiscoveryJob, completeDiscoveryJob, enqueueDiscoveryJob } from "./jobs";
import type { PrivacyActor } from "./permissions";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function queued(db: TestDb, signal: AbortSignal) {
  signal.throwIfAborted();
  // Synthetic fresh-assurance rows exercise native DB authority, not browser authentication.
  const original = await authorityFixture(db, ["case.review"]);
  signal.throwIfAborted();
  const input = {
    caseId: original.privacyCase.id,
    expectedScopeVersion: 1,
    idempotencyKey: randomUUID(),
  };
  const receipt = await enqueueDiscoveryJob(db.db, original.actor, input, signal);
  assert(receipt.ok, "synthetic discovery job did not queue");
  return { original, input, receipt: receipt.value };
}
type Queued = Awaited<ReturnType<typeof queued>>;

async function snapshot(db: TestDb, fixture: Queued, signal: AbortSignal) {
  const [job] = await db.db
    .select()
    .from(privacyJobs)
    .where(eq(privacyJobs.id, fixture.receipt.id));
  signal.throwIfAborted();
  const [privacyCase] = await db.db
    .select()
    .from(privacyCases)
    .where(eq(privacyCases.id, fixture.input.caseId));
  signal.throwIfAborted();
  const [proof] = await db.db
    .select()
    .from(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, fixture.input.caseId));
  signal.throwIfAborted();
  assert(job !== undefined && privacyCase !== undefined && proof !== undefined);
  return { job, privacyCase, proof };
}

async function expectObservation(fixture: Queued, reviewer: PrivacyActor, signal: AbortSignal) {
  const before = await snapshot(h, fixture, signal);
  expect(
    await getDiscoveryJobStatus(
      h.db,
      reviewer,
      { caseId: fixture.input.caseId, jobId: fixture.receipt.id },
      signal,
    ),
  ).toEqual({
    ok: true,
    value: {
      id: before.job.id,
      caseId: before.job.caseId,
      kind: "discovery",
      status: before.job.status,
      attempts: before.job.attempts,
      updatedAt: before.job.updatedAt,
    },
  });
  expect(await snapshot(h, fixture, signal)).toEqual(before);
}

for (const boundary of ["expired originating session", "subject binding drift"] as const)
  test(`C01/C03: current reviewer observes after ${boundary} without renewing worker authority`, async ({
    signal,
  }) => {
    const fixture = await queued(h, signal);
    const reviewer = await authorityFixture(h, ["case.review"]);
    signal.throwIfAborted();
    assert.notEqual(reviewer.actor.userId, fixture.original.actor.userId);
    await h.db.insert(privacyCaseMembers).values({
      caseId: fixture.input.caseId,
      userId: reviewer.user.id,
      capabilities: ["case.review"],
    });
    signal.throwIfAborted();
    const claim = await claimDiscoveryJob(h.db, fixture.receipt.id, signal);
    assert(claim.ok, "synthetic discovery job did not claim before drift");
    if (boundary === "expired originating session")
      await h.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, fixture.original.session.id));
    // A valid reference deliberately disagrees with the still-encrypted subject proof.
    else
      await h.db
        .update(privacyCaseVerifications)
        .set({ subjectReferenceId: reviewer.user.id })
        .where(eq(privacyCaseVerifications.caseId, fixture.input.caseId));
    signal.throwIfAborted();
    await expectObservation(fixture, reviewer.actor, signal);
    expect(
      await completeDiscoveryJob(
        h.db,
        fixture.receipt.id,
        claim.value.claimToken,
        { recordCount: 1, reviewRequired: true },
        signal,
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    const attention = await snapshot(h, fixture, signal);
    expect(attention.job).toMatchObject({
      status: "needs_attention",
      lastErrorCode: "authority_changed",
      resultEnc: null,
    });
    await expectObservation(fixture, reviewer.actor, signal);
    expect(await claimDiscoveryJob(h.db, fixture.receipt.id, signal)).toEqual({
      ok: false,
      error: "forbidden",
    });
    await expectObservation(fixture, reviewer.actor, signal);
  });

test("C11: native PG pool exhaustion returns only storage_unavailable", async ({ signal }) => {
  const fixture = await queued(h, signal);
  const pool = new Pool({ connectionString: h.url, max: 1, connectionTimeoutMillis: 50 });
  const client = await pool.connect();
  try {
    signal.throwIfAborted();
    await expect(
      getDiscoveryJobStatus(
        drizzle(pool, { schema }),
        fixture.original.actor,
        { caseId: fixture.input.caseId, jobId: fixture.receipt.id },
        signal,
      ),
    ).resolves.toEqual({ ok: false, error: "storage_unavailable" });
  } finally {
    client.release();
    await pool.end();
  }
});

async function waitForStatusLock(applicationName: string, blockerPid: number, signal: AbortSignal) {
  for (;;) {
    signal.throwIfAborted();
    const result = await h.pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = $1
          AND wait_event_type = 'Lock' AND $2 = ANY(pg_blocking_pids(pid))
          AND query LIKE '%privacy_jobs%'
      ) AS waiting`,
      [applicationName, blockerPid],
    );
    signal.throwIfAborted();
    if (result.rows[0]?.waiting === true) return;
    await delay(10, undefined, { signal });
  }
}

test("C06: blocked PG status cancellation leaves durable rows unchanged", async ({ signal }) => {
  const fixture = await queued(h, signal);
  const before = await snapshot(h, fixture, signal);
  const applicationName = `privacy-status-cancel-${randomUUID()}`;
  const readerPool = new Pool({
    connectionString: h.url,
    max: 1,
    application_name: applicationName,
    connectionTimeoutMillis: 1000,
    statement_timeout: 5000,
  });
  const blocker = await h.pool.connect();
  const controller = new AbortController();
  const cancellation = new DOMException("Synthetic in-flight status cancellation", "AbortError");
  let readOutcome: Promise<unknown> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SET LOCAL lock_timeout = '2s'");
    await blocker.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    await blocker.query("LOCK TABLE privacy_jobs IN ACCESS EXCLUSIVE MODE");
    const pid = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const blockerPid = pid.rows[0]?.pid;
    assert(blockerPid !== undefined, "missing synthetic lock holder PID");
    const readSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(10_000)]);
    readOutcome = getDiscoveryJobStatus(
      drizzle(readerPool, { schema }),
      fixture.original.actor,
      { caseId: fixture.input.caseId, jobId: fixture.receipt.id },
      readSignal,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await waitForStatusLock(
      applicationName,
      blockerPid,
      AbortSignal.any([signal, AbortSignal.timeout(2500)]),
    );
    controller.abort(cancellation);
  } finally {
    controller.abort(cancellation);
    try {
      await blocker.query("ROLLBACK");
    } finally {
      blocker.release(true);
      await readOutcome;
      await readerPool.end();
    }
  }
  assert(readOutcome !== undefined, "synthetic read never started");
  expect(await readOutcome).toEqual({ error: cancellation });
  expect(await snapshot(h, fixture, signal)).toEqual(before);
});
