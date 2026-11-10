import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type QueryResult } from "pg";
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
import { createDiscoveryJobStatusReader, getDiscoveryJobStatus } from "./jobStatus";
import {
  confirmStatusBackendWait,
  finishStatusCancellation,
  observeStatusBackendRollback,
  retainAssertion,
  type StatusOutcome,
  waitForStatusBackend,
} from "./jobStatusCancellation.test-helpers";
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

test("C06: original PG backend acknowledges rollback before held-blocker release", async ({
  signal,
}) => {
  const fixture = await queued(h, signal);
  const before = await snapshot(h, fixture, signal);
  const applicationName = `privacy-status-cancel-${randomUUID()}`;
  const readerPool = new Pool({
    connectionString: h.url,
    max: 1,
    application_name: applicationName,
    connectionTimeoutMillis: 1000,
    statement_timeout: 5000,
    pipeline: false,
  });
  const controlPool = new Pool({
    connectionString: h.url,
    max: 1,
    connectionTimeoutMillis: 100,
    statement_timeout: 100,
    query_timeout: 100,
    pipeline: false,
  });
  const readStatus = createDiscoveryJobStatusReader(readerPool, controlPool);
  const controller = new AbortController();
  const cancellation = new DOMException(
    `Synthetic held-lock cancellation ${randomUUID()}`,
    "AbortError",
  );
  let blocker: PoolClient | undefined;
  let observer: PoolClient | undefined;
  let readOutcome: Promise<StatusOutcome> | undefined;
  let recovery:
    | Promise<
        | { kind: "fulfilled"; value: QueryResult<{ usable: number }> }
        | { kind: "rejected"; error: unknown }
      >
    | undefined;
  const failures: unknown[] = [];
  try {
    blocker = await h.pool.connect();
    observer = await h.pool.connect();
    await observer.query("SET statement_timeout='500ms'");
    await blocker.query("BEGIN");
    await blocker.query("SET LOCAL lock_timeout='2s'");
    await blocker.query("SET LOCAL idle_in_transaction_session_timeout='10s'");
    await blocker.query("LOCK TABLE privacy_jobs IN ACCESS EXCLUSIVE MODE");
    const holder = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const blockerPid = holder.rows[0]?.pid;
    assert(blockerPid !== undefined, "SETUP: missing exact status lock-holder PID");
    const readStartedAt = performance.now();
    const readSignal = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(10_000)]);
    readOutcome = readStatus(
      fixture.original.actor,
      { caseId: fixture.input.caseId, jobId: fixture.receipt.id },
      readSignal,
    ).then(
      (value) => ({ kind: "resolved" as const, value }),
      (reason: unknown) => ({ kind: "rejected" as const, reason }),
    );
    const barrier = await waitForStatusBackend(
      observer,
      applicationName,
      blockerPid,
      readOutcome,
      signal,
    );
    assert(
      barrier.kind !== "setup_deadline",
      "SETUP/TIMING: native status lock wait not observed within 2.5s",
    );
    assert(
      barrier.kind === "waiting",
      "BEHAVIOR: status reader settled before reaching its native lock barrier",
    );
    const backend = barrier.backend;
    expect(backend.pid).not.toBe(blockerPid);
    assert(
      await confirmStatusBackendWait(observer, backend, blockerPid, signal),
      "SETUP/IDENTITY: retained PID+native backend-start text must resolve to the active transaction and exact held lock wait before abort",
    );
    controller.abort(cancellation);
    const [witness, outcome] = await Promise.all([
      observeStatusBackendRollback(observer, backend, blockerPid, signal).catch(
        (cause: unknown) => ({ kind: "observation_failed" as const, cause }),
      ),
      Promise.race([
        readOutcome,
        delay(1000, { kind: "caller_deadline" } as const, { ref: false }),
      ]),
    ]);
    // This native witness is the primary assertion, before promise/pool controls or blocker release.
    retainAssertion(failures, () => {
      if (witness.kind === "observation_failed")
        throw new AggregateError(
          [witness.cause],
          "OBSERVATION: native backend acknowledgement could not be measured",
        );
      assert(
        witness.kind !== "blocker_lost",
        "SETUP: original native blocker vanished during acknowledgement",
      );
      assert(
        witness.kind !== "observation_deadline",
        "OBSERVATION: native acknowledgement was not witnessed in time",
      );
      expect(
        witness.kind,
        "BEHAVIOR: original backend must disappear or finish plus roll back all transaction locks while blocker stays held",
      ).toBe("acknowledged");
    });
    retainAssertion(failures, () => {
      expect(
        performance.now() - readStartedAt,
        "SETUP/TIMING: acknowledgement must precede native statement timeout",
      ).toBeLessThan(5000);
      expect(
        outcome.kind,
        "CALLER: cancellation must settle within one second while blocker stays held",
      ).toBe("rejected");
      if (outcome.kind === "rejected") expect(outcome.reason).toBe(cancellation);
    });
    recovery = readerPool.query<{ usable: number }>("SELECT 1 AS usable").then(
      (value) => ({ kind: "fulfilled" as const, value }),
      (error: unknown) => ({ kind: "rejected" as const, error }),
    );
    const recovered = await Promise.race([
      recovery,
      delay(1000, { kind: "recovery_deadline" } as const, { ref: false }),
    ]);
    retainAssertion(failures, () => {
      if (recovered.kind === "rejected")
        throw new AggregateError(
          [recovered.error],
          "POOL: same max-one recovery rejected before blocker release",
        );
      expect(
        recovered.kind,
        "POOL: same max-one reader pool must recover before blocker release",
      ).toBe("fulfilled");
      if (recovered.kind === "fulfilled") expect(recovered.value.rows).toEqual([{ usable: 1 }]);
    });
    const held = await observer.query<{ held: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid=$1 AND relation='privacy_jobs'::regclass AND mode='AccessExclusiveLock' AND granted) AS held",
      [blockerPid],
    );
    retainAssertion(failures, () => {
      expect(
        held.rows[0]?.held,
        "SETUP: blocker must stay held through caller and same-pool controls",
      ).toBe(true);
      expect(
        performance.now() - readStartedAt,
        "SETUP/TIMING: controls must precede native statement timeout",
      ).toBeLessThan(5000);
    });
  } catch (error) {
    failures.push(error);
  } finally {
    controller.abort(cancellation);
    failures.push(
      ...(await finishStatusCancellation(
        blocker,
        observer,
        readerPool,
        controlPool,
        readOutcome,
        recovery,
        async () => {
          const recoverySignal = AbortSignal.timeout(2500);
          expect(await snapshot(h, fixture, recoverySignal)).toEqual(before);
          expect(
            await readStatus(
              fixture.original.actor,
              { caseId: fixture.input.caseId, jobId: fixture.receipt.id },
              recoverySignal,
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
          expect(await snapshot(h, fixture, recoverySignal)).toEqual(before);
        },
      )),
    );
  }
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      "Status backend acknowledgement, caller, pool or cleanup controls failed",
    );
  if (failures.length === 1) throw failures[0];
});
