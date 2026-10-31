import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyAuthority, privacyCases, privacyJobs } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { transitionPrivacyCase } from "./caseCommands";
import { claimDiscoveryJob, completeDiscoveryJob, enqueueDiscoveryJob } from "./jobs";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
async function queued() {
  const f = await authorityFixture(h, ["case.review"]);
  const command = {
    caseId: f.privacyCase.id,
    expectedScopeVersion: 1,
    idempotencyKey: randomUUID(),
  };
  const result = await enqueueDiscoveryJob(h.db, f.actor, command, authoritySignal());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new TypeError("Synthetic discovery job did not queue");
  return { f, command, job: result.value };
}

test("P03A/P03B: duplicate discovery commands share one durable job without changing case state", async () => {
  const { f, command, job } = await queued();
  const results = await Promise.all([
    enqueueDiscoveryJob(h.db, f.actor, command, authoritySignal()),
    enqueueDiscoveryJob(h.db, f.actor, command, authoritySignal()),
  ]);
  expect(results).toEqual([
    { ok: true, value: job },
    { ok: true, value: job },
  ]);
  expect(
    await h.db.select().from(privacyJobs).where(eq(privacyJobs.caseId, command.caseId)),
  ).toHaveLength(1);
  expect(
    (await h.db.select().from(privacyCases).where(eq(privacyCases.id, command.caseId)))[0]?.status,
  ).toBe("under_review");
  expect(
    await enqueueDiscoveryJob(h.db, f.actor, { ...command, kind: "erasure" }, authoritySignal()),
  ).toEqual({ ok: false, error: "invalid_input" });
});

test("P03B/C05/C06: competing claims and expired leases fence stale completion", async () => {
  const { f, job } = await queued();
  const claims = await Promise.all([
    claimDiscoveryJob(h.db, job.id, authoritySignal()),
    claimDiscoveryJob(h.db, job.id, authoritySignal()),
  ]);
  expect(claims.filter((r) => r.ok)).toHaveLength(1);
  const first = claims.find((r) => r.ok);
  if (first === undefined || !first.ok) return;
  await h.db
    .update(privacyJobs)
    .set({ leaseUntil: new Date(Date.now() - 1000) })
    .where(eq(privacyJobs.id, job.id));
  const replacement = await claimDiscoveryJob(h.db, job.id, authoritySignal());
  expect(replacement.ok).toBe(true);
  if (!replacement.ok) return;
  const receipt = { recordCount: 0, reviewRequired: true };
  expect(
    await completeDiscoveryJob(h.db, job.id, first.value.claimToken, receipt, authoritySignal()),
  ).toEqual({ ok: false, error: "lease_lost" });
  expect(
    (
      await completeDiscoveryJob(
        h.db,
        job.id,
        replacement.value.claimToken,
        receipt,
        authoritySignal(),
      )
    ).ok,
  ).toBe(true);
  expect(
    (await h.db.select().from(privacyCases).where(eq(privacyCases.id, f.privacyCase.id)))[0]
      ?.status,
  ).toBe("under_review");
});

test("P03B/C03: authority loss after enqueue blocks claiming and records attention without results", async () => {
  const { f, job } = await queued();
  await h.db
    .update(privacyAuthority)
    .set({ capabilities: [], generation: 2 })
    .where(eq(privacyAuthority.userId, f.user.id));
  expect(await claimDiscoveryJob(h.db, job.id, authoritySignal())).toEqual({
    ok: false,
    error: "forbidden",
  });
  const [row] = await h.db.select().from(privacyJobs).where(eq(privacyJobs.id, job.id));
  expect(row?.status).toBe("needs_attention");
  expect(row?.resultEnc).toBeNull();
});

test("C03: case cancellation or refusal prevents later discovery effects", async () => {
  for (const toStatus of ["cancelled", "refused"] as const) {
    const { f, job } = await queued();
    const changed = await transitionPrivacyCase(
      h.db,
      f.actor,
      {
        caseId: f.privacyCase.id,
        expectedVersion: 1,
        commandId: randomUUID(),
        toStatus,
        reason: "Synthetic review decision",
      },
      authoritySignal(),
    );
    expect(changed.ok).toBe(true);
    expect((await claimDiscoveryJob(h.db, job.id, authoritySignal())).ok).toBe(false);
    const [row] = await h.db.select().from(privacyJobs).where(eq(privacyJobs.id, job.id));
    expect(row?.status).toBe("needs_attention");
    expect(row?.resultEnc).toBeNull();
  }
});

test("C06: exhausted attempts record the correct repair cause", async () => {
  const { job } = await queued();
  await h.db.update(privacyJobs).set({ attempts: 5 }).where(eq(privacyJobs.id, job.id));
  expect(await claimDiscoveryJob(h.db, job.id, authoritySignal())).toEqual({
    ok: false,
    error: "attempts_exhausted",
  });
  const [row] = await h.db.select().from(privacyJobs).where(eq(privacyJobs.id, job.id));
  expect(row?.lastErrorCode).toBe("attempts_exhausted");
});

test("C03: a previously leased job cannot publish after the case is refused", async () => {
  const { f, job } = await queued();
  const claim = await claimDiscoveryJob(h.db, job.id, authoritySignal());
  expect(claim.ok).toBe(true);
  if (!claim.ok) return;
  expect(
    (
      await transitionPrivacyCase(
        h.db,
        f.actor,
        {
          caseId: f.privacyCase.id,
          expectedVersion: 1,
          commandId: randomUUID(),
          toStatus: "refused",
          reason: "Synthetic refusal",
        },
        authoritySignal(),
      )
    ).ok,
  ).toBe(true);
  expect(
    await completeDiscoveryJob(
      h.db,
      job.id,
      claim.value.claimToken,
      { recordCount: 0, reviewRequired: true },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "case_not_reviewable" });
  const [row] = await h.db.select().from(privacyJobs).where(eq(privacyJobs.id, job.id));
  expect(row?.status).toBe("needs_attention");
  expect(row?.resultEnc).toBeNull();
});
