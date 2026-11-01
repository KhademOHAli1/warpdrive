import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  privacyJobs,
  sessions,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import { getDiscoveryJobStatus } from "./jobStatus";
import { claimDiscoveryJob, completeDiscoveryJob, enqueueDiscoveryJob } from "./jobs";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function queued(signal: AbortSignal) {
  signal.throwIfAborted();
  const f = await authorityFixture(h, ["case.review"]);
  signal.throwIfAborted();
  const command = {
    caseId: f.privacyCase.id,
    expectedScopeVersion: 1,
    idempotencyKey: randomUUID(),
  };
  const created = await enqueueDiscoveryJob(h.db, f.actor, command, signal);
  assert(created.ok, "synthetic discovery job did not queue");
  return { f, command, receipt: created.value };
}
type Queued = Awaited<ReturnType<typeof queued>>;

async function snapshot(fixture: Queued, signal: AbortSignal) {
  const [job] = await h.db.select().from(privacyJobs).where(eq(privacyJobs.id, fixture.receipt.id));
  signal.throwIfAborted();
  const [privacyCase] = await h.db
    .select()
    .from(privacyCases)
    .where(eq(privacyCases.id, fixture.command.caseId));
  signal.throwIfAborted();
  assert(job !== undefined && privacyCase !== undefined, "missing synthetic lifecycle rows");
  return { job, privacyCase };
}

async function expectStatus(
  fixture: Queued,
  status: "queued" | "running" | "succeeded" | "needs_attention",
  signal: AbortSignal,
) {
  const before = await snapshot(fixture, signal);
  const result = await getDiscoveryJobStatus(
    h.db,
    fixture.f.actor,
    { caseId: fixture.command.caseId, jobId: fixture.receipt.id },
    signal,
  );
  expect(result).toEqual({
    ok: true,
    value: {
      id: fixture.receipt.id,
      caseId: fixture.command.caseId,
      kind: "discovery",
      status,
      attempts: before.job.attempts,
      updatedAt: before.job.updatedAt,
    },
  });
  expect(await snapshot(fixture, signal)).toEqual(before);
}

test("P03A/P12A: current job reads follow queued, running and succeeded without changing rows", async ({
  signal,
}) => {
  const fixture = await queued(signal);
  await expectStatus(fixture, "queued", signal);
  const claim = await claimDiscoveryJob(h.db, fixture.receipt.id, signal);
  assert(claim.ok, "synthetic discovery job did not claim");
  await expectStatus(fixture, "running", signal);
  const completed = await completeDiscoveryJob(
    h.db,
    fixture.receipt.id,
    claim.value.claimToken,
    { recordCount: 17, reviewRequired: true },
    signal,
  );
  expect(completed.ok).toBe(true);
  await expectStatus(fixture, "succeeded", signal);
  expect(await enqueueDiscoveryJob(h.db, fixture.f.actor, fixture.command, signal)).toEqual({
    ok: true,
    value: fixture.receipt,
  });
  expect(fixture.receipt.status).toBe("queued");
  const rows = await h.db
    .select({ id: privacyJobs.id })
    .from(privacyJobs)
    .where(eq(privacyJobs.caseId, fixture.command.caseId));
  signal.throwIfAborted();
  expect(rows).toEqual([{ id: fixture.receipt.id }]);
});

test("C06/P12A: native exhausted-attempt attention stays visible and a read never repairs it", async ({
  signal,
}) => {
  const fixture = await queued(signal);
  await h.db.update(privacyJobs).set({ attempts: 5 }).where(eq(privacyJobs.id, fixture.receipt.id));
  signal.throwIfAborted();
  expect(await claimDiscoveryJob(h.db, fixture.receipt.id, signal)).toEqual({
    ok: false,
    error: "attempts_exhausted",
  });
  await expectStatus(fixture, "needs_attention", signal);
});

test("C01/C10: exact minimal status keys omit encrypted content and worker credentials", async ({
  signal,
}) => {
  const fixture = await queued(signal);
  const claim = await claimDiscoveryJob(h.db, fixture.receipt.id, signal);
  assert(claim.ok, "synthetic discovery job did not claim");
  expect(
    (
      await completeDiscoveryJob(
        h.db,
        fixture.receipt.id,
        claim.value.claimToken,
        { recordCount: 73, reviewRequired: true },
        signal,
      )
    ).ok,
  ).toBe(true);
  const result = await getDiscoveryJobStatus(
    h.db,
    fixture.f.actor,
    { caseId: fixture.command.caseId, jobId: fixture.receipt.id },
    signal,
  );
  assert(result.ok, "synthetic discovery job status was denied");
  expect(Object.keys(result.value).sort()).toEqual([
    "attempts",
    "caseId",
    "id",
    "kind",
    "status",
    "updatedAt",
  ]);
});

test("C01/C04: another case's job and an unknown job have the same not-found outcome", async ({
  signal,
}) => {
  const allowed = await queued(signal);
  const other = await queued(signal);
  for (const jobId of [other.receipt.id, randomUUID()])
    expect(
      await getDiscoveryJobStatus(
        h.db,
        allowed.f.actor,
        { caseId: allowed.command.caseId, jobId },
        signal,
      ),
    ).toEqual({ ok: false, error: "not_found" });
});

test("P02B/C01: global review authority without membership in the requested case denies", async ({
  signal,
}) => {
  const allowed = await queued(signal);
  const unrelated = await authorityFixture(h, ["case.review"]);
  signal.throwIfAborted();
  expect(
    await getDiscoveryJobStatus(
      h.db,
      unrelated.actor,
      { caseId: allowed.command.caseId, jobId: allowed.receipt.id },
      signal,
    ),
  ).toEqual({ ok: false, error: "forbidden" });
});

for (const boundary of ["authority", "membership", "session"] as const)
  test(`P02B/C03: current ${boundary} loss denies a previously readable job`, async ({
    signal,
  }) => {
    const fixture = await queued(signal);
    await expectStatus(fixture, "queued", signal);
    if (boundary === "authority")
      await h.db
        .update(privacyAuthority)
        .set({ capabilities: [], generation: 2 })
        .where(eq(privacyAuthority.userId, fixture.f.user.id));
    if (boundary === "membership")
      await h.db
        .update(privacyCaseMembers)
        .set({ revokedAt: new Date(), generation: 2 })
        .where(
          and(
            eq(privacyCaseMembers.caseId, fixture.command.caseId),
            eq(privacyCaseMembers.userId, fixture.f.user.id),
          ),
        );
    if (boundary === "session")
      await h.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, fixture.f.session.id));
    signal.throwIfAborted();
    expect(
      await getDiscoveryJobStatus(
        h.db,
        fixture.f.actor,
        { caseId: fixture.command.caseId, jobId: fixture.receipt.id },
        signal,
      ),
    ).toEqual({ ok: false, error: "forbidden" });
  });

test("C01: the discovery reader does not expose another job kind", async ({ signal }) => {
  const fixture = await queued(signal);
  await h.db
    .update(privacyJobs)
    .set({ kind: "export" })
    .where(eq(privacyJobs.id, fixture.receipt.id));
  signal.throwIfAborted();
  const before = await snapshot(fixture, signal);
  expect(
    await getDiscoveryJobStatus(
      h.db,
      fixture.f.actor,
      { caseId: fixture.command.caseId, jobId: fixture.receipt.id },
      signal,
    ),
  ).toEqual({ ok: false, error: "not_found" });
  expect(await snapshot(fixture, signal)).toEqual(before);
});

test("C01: malformed or extra input fields fail before a job status is returned", async ({
  signal,
}) => {
  const fixture = await queued(signal);
  const valid = { caseId: fixture.command.caseId, jobId: fixture.receipt.id };
  for (const input of [
    null,
    {},
    { ...valid, caseId: "invalid" },
    { ...valid, jobId: "invalid" },
    { ...valid, kind: "erasure" },
    { ...valid, userId: fixture.f.user.id },
  ])
    expect(await getDiscoveryJobStatus(h.db, fixture.f.actor, input, signal)).toEqual({
      ok: false,
      error: "invalid_input",
    });
});

test("C06: cancellation stays cancellation and leaves the durable job unchanged", async ({
  signal,
}) => {
  const fixture = await queued(signal);
  const before = await snapshot(fixture, signal);
  const controller = new AbortController();
  const cancellation = new DOMException("Synthetic job status cancellation", "AbortError");
  controller.abort(cancellation);
  await expect(
    getDiscoveryJobStatus(
      h.db,
      fixture.f.actor,
      { caseId: fixture.command.caseId, jobId: fixture.receipt.id },
      controller.signal,
    ),
  ).rejects.toBe(cancellation);
  expect(await snapshot(fixture, signal)).toEqual(before);
});
