import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  privacyAuthority,
  privacyCaseEvents,
  privacyCaseMembers,
  privacyCases,
  users,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { claimPrivacyCase } from "./caseAssignment";
import { listPrivacyIntakeQueue } from "./caseAssignmentQueue";
import { verifyOwnPrivacyIdentity } from "./identitySelf";
import { withPrivacyAuthority } from "./permissions";
import { createOwnPrivacyCase } from "./selfService";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const grants = [
  "case.assign",
  "authority.manage",
  "case.review",
  "case.disclose",
  "case.export",
] as const;
async function pending() {
  const requester = await authorityFixture(h, []);
  const created = await createOwnPrivacyCase(
    h.db,
    requester.actor,
    { intakeKey: randomUUID(), kind: "access", locale: "en", summary: "PRIVATE-REQUEST" },
    authoritySignal(),
  );
  expect(created.ok).toBe(true);
  assert(created.ok, "synthetic pending case missing");
  return { requester, caseId: created.value.id };
}
const command = (caseId: string, expectedVersion = 1) => ({
  caseId,
  expectedVersion,
  commandId: randomUUID(),
});

test("P12A: explicit intake assignment creates the first reviewer scope without changing subject proof", async () => {
  const f = await pending();
  const reviewer = await authorityFixture(h, [...grants]);
  expect(
    (await verifyOwnPrivacyIdentity(h.db, f.requester.actor, command(f.caseId), authoritySignal()))
      .ok,
  ).toBe(true);
  const input = command(f.caseId, 2);
  const claimed = await claimPrivacyCase(h.db, reviewer.actor, input, authoritySignal());
  expect(claimed).toMatchObject({
    ok: true,
    value: { id: f.caseId, version: 3, status: "received" },
  });
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, f.caseId));
  expect(row).toMatchObject({ scopeVersion: 1, verificationVersion: 2, recipientVersion: 1 });
  const [member] = await h.db
    .select()
    .from(privacyCaseMembers)
    .where(
      and(eq(privacyCaseMembers.caseId, f.caseId), eq(privacyCaseMembers.userId, reviewer.user.id)),
    );
  expect(member?.capabilities).toEqual([
    "case.review",
    "case.disclose",
    "case.export",
    "authority.manage",
  ]);
  expect(
    await withPrivacyAuthority(
      h.db,
      reviewer.actor,
      { caseId: f.caseId, capability: "case.disclose" },
      authoritySignal(),
      () => Promise.resolve(ok(true)),
    ),
  ).toEqual(ok(true));
  expect(await claimPrivacyCase(h.db, reviewer.actor, input, authoritySignal())).toEqual(claimed);
  expect(
    await claimPrivacyCase(
      h.db,
      reviewer.actor,
      { ...input, expectedVersion: 3 },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "idempotency_conflict" });
});

test("P02B: native administrator and global review authority alone cannot claim unrelated intake", async () => {
  const f = await pending();
  const reviewer = await authorityFixture(h, ["authority.manage", "case.review", "case.disclose"]);
  await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, reviewer.user.id));
  expect(
    await claimPrivacyCase(h.db, reviewer.actor, command(f.caseId), authoritySignal()),
  ).toEqual({ ok: false, error: "forbidden" });
  expect(
    await listPrivacyIntakeQueue(h.db, reviewer.actor, { limit: 10 }, authoritySignal()),
  ).toEqual({ ok: false, error: "forbidden" });
});

test("P12B: two eligible operators cannot both claim the initial case authority", async () => {
  const f = await pending();
  const a = await authorityFixture(h, [...grants]);
  const b = await authorityFixture(h, [...grants]);
  const results = await Promise.all([
    claimPrivacyCase(h.db, a.actor, command(f.caseId), authoritySignal()),
    claimPrivacyCase(h.db, b.actor, command(f.caseId), authoritySignal()),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "stale_version" }]);
  expect(
    await h.db
      .select()
      .from(privacyCaseEvents)
      .where(
        and(eq(privacyCaseEvents.caseId, f.caseId), eq(privacyCaseEvents.action, "case.assigned")),
      ),
  ).toHaveLength(1);
});

test("P12B: an existing reviewed case cannot be taken over using global assignment", async () => {
  const owner = await authorityFixture(h, ["case.review"]);
  const reviewer = await authorityFixture(h, [...grants]);
  await h.db
    .update(privacyCases)
    .set({ status: "received" })
    .where(eq(privacyCases.id, owner.privacyCase.id));
  expect(
    await claimPrivacyCase(h.db, reviewer.actor, command(owner.privacyCase.id), authoritySignal()),
  ).toEqual({ ok: false, error: "case_assigned" });
});

test("P12B: replay cannot restore a revoked membership or revoked global assignment capability", async () => {
  const f = await pending();
  const reviewer = await authorityFixture(h, [...grants]);
  const input = command(f.caseId);
  expect((await claimPrivacyCase(h.db, reviewer.actor, input, authoritySignal())).ok).toBe(true);
  await h.db
    .update(privacyCaseMembers)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(privacyCaseMembers.caseId, f.caseId), eq(privacyCaseMembers.userId, reviewer.user.id)),
    );
  expect(await claimPrivacyCase(h.db, reviewer.actor, input, authoritySignal())).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(
    await claimPrivacyCase(h.db, reviewer.actor, command(f.caseId, 2), authoritySignal()),
  ).toEqual({ ok: false, error: "case_assigned" });
  await h.db
    .update(privacyAuthority)
    .set({ capabilities: ["case.review", "authority.manage"] })
    .where(eq(privacyAuthority.userId, reviewer.user.id));
  expect(await claimPrivacyCase(h.db, reviewer.actor, input, authoritySignal())).toEqual({
    ok: false,
    error: "forbidden",
  });
});

test("P12A: the assignment queue is bounded, paged, unassigned-only and excludes sensitive intake", async () => {
  const a = await pending();
  const b = await pending();
  const reviewer = await authorityFixture(h, [...grants]);
  const seen: string[] = [];
  let afterId: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await listPrivacyIntakeQueue(
      h.db,
      reviewer.actor,
      { limit: 2, afterId },
      authoritySignal(),
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(page)).not.toContain("PRIVATE-");
    expect(page.value.snapshot).toBe("live_unassigned");
    seen.push(...page.value.items.map((item) => item.id));
    if (page.value.nextAfterId === null) break;
    afterId = page.value.nextAfterId;
  }
  expect(seen).toContain(a.caseId);
  expect(seen).toContain(b.caseId);
  expect(new Set(seen).size).toBe(seen.length);
  expect(
    (await claimPrivacyCase(h.db, reviewer.actor, command(a.caseId), authoritySignal())).ok,
  ).toBe(true);
  const remaining = await listPrivacyIntakeQueue(
    h.db,
    reviewer.actor,
    { limit: 100 },
    authoritySignal(),
  );
  expect(remaining.ok).toBe(true);
  if (remaining.ok) expect(remaining.value.items.map((item) => item.id)).not.toContain(a.caseId);
  expect(
    await listPrivacyIntakeQueue(h.db, reviewer.actor, { limit: 101 }, authoritySignal()),
  ).toEqual({ ok: false, error: "invalid_input" });
});
