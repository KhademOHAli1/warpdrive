import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  authUsers,
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  sessions,
  users,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { encryptPrivacy } from "./crypto";
import { readPrivacyReviewerCase } from "./reviewerCase";
import {
  denyReviewerRole,
  PRIVATE_REVIEWER_CONTEXT,
  type ReviewerCaseFixture,
  reviewerCaseFixture,
  reviewerCaseSnapshot,
} from "./reviewerCase.test-helpers";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});
async function readUnchanged(
  f: ReviewerCaseFixture,
  input: unknown = { caseId: f.privacyCase.id },
  actor = f.actor,
) {
  const before = await reviewerCaseSnapshot(h);
  const result = await readPrivacyReviewerCase(h.db, actor, input, authoritySignal());
  expect(await reviewerCaseSnapshot(h)).toEqual(before);
  return result;
}

type IntakeDamage =
  | "ciphertext"
  | "wrong case"
  | "wrong purpose"
  | "invalid JSON"
  | "invalid root"
  | "extra property"
  | "invalid locale"
  | "oversized summary";

function damagedIntakeBody(f: ReviewerCaseFixture, damage: IntakeDamage): string {
  switch (damage) {
    case "invalid JSON":
      return `{${PRIVATE_REVIEWER_CONTEXT}`;
    case "invalid root":
      return JSON.stringify([f.intake]);
    case "extra property":
      return JSON.stringify({ ...f.intake, secret: PRIVATE_REVIEWER_CONTEXT });
    case "invalid locale":
      return JSON.stringify({ ...f.intake, locale: PRIVATE_REVIEWER_CONTEXT });
    case "oversized summary":
      return JSON.stringify({ ...f.intake, summary: "s".repeat(4001) });
    case "ciphertext":
    case "wrong case":
    case "wrong purpose":
      return JSON.stringify(f.intake);
  }
}

function damagedIntakeCiphertext(f: ReviewerCaseFixture, damage: IntakeDamage): Buffer {
  if (damage === "ciphertext") return Buffer.from(PRIVATE_REVIEWER_CONTEXT);
  return encryptPrivacy(damagedIntakeBody(f, damage), {
    caseId: damage === "wrong case" ? randomUUID() : f.privacyCase.id,
    purpose: damage === "wrong purpose" ? "identity" : "intake",
  });
}

for (const boundary of [
  "missing global",
  "global review removed",
  "missing member",
  "member review removed",
  "revoked member",
  "assignment only",
  "disclosure only",
] as const)
  test(`${boundary} cannot read assigned intake`, async () => {
    const f = await reviewerCaseFixture(h);
    if (boundary === "missing global")
      await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
    else if (boundary === "global review removed")
      await h.db
        .update(privacyAuthority)
        .set({ capabilities: [] })
        .where(eq(privacyAuthority.userId, f.user.id));
    else if (boundary === "missing member")
      await h.db.delete(privacyCaseMembers).where(eq(privacyCaseMembers.caseId, f.privacyCase.id));
    else if (boundary === "member review removed")
      await h.db
        .update(privacyCaseMembers)
        .set({ capabilities: [] })
        .where(eq(privacyCaseMembers.caseId, f.privacyCase.id));
    else if (boundary === "revoked member")
      await h.db
        .update(privacyCaseMembers)
        .set({ revokedAt: new Date() })
        .where(eq(privacyCaseMembers.caseId, f.privacyCase.id));
    else {
      const capabilities =
        boundary === "assignment only" ? ["case.assign" as const] : ["case.disclose" as const];
      await h.db
        .update(privacyAuthority)
        .set({ capabilities })
        .where(eq(privacyAuthority.userId, f.user.id));
      await h.db
        .update(privacyCaseMembers)
        .set({ capabilities })
        .where(eq(privacyCaseMembers.caseId, f.privacyCase.id));
    }
    expect(await readUnchanged(f)).toEqual({ ok: false, error: "forbidden" });
  });

for (const role of ["administrator", "requester", "record owner"] as const)
  test(`${role} and creator status never replace explicit reviewer authority`, async () => {
    const f = await reviewerCaseFixture(h);
    await denyReviewerRole(h, f, role);
    expect(await readUnchanged(f)).toEqual({ ok: false, error: "forbidden" });
  });

test("a reviewer assigned only to another case receives the same denial as an unknown case", async () => {
  const f = await reviewerCaseFixture(h);
  const other = await authorityFixture(h, ["case.review"]);
  expect(await readUnchanged(f, { caseId: f.privacyCase.id }, other.actor)).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(await readUnchanged(f, { caseId: randomUUID() })).toEqual({
    ok: false,
    error: "forbidden",
  });
});

for (const boundary of [
  "expired",
  "stale fresh",
  "revoked",
  "inactive",
  "unverified auth",
] as const)
  test(`${boundary} native account/session cannot read previously assigned context`, async () => {
    const f = await reviewerCaseFixture(h);
    if (boundary === "inactive")
      await h.db.update(users).set({ isActive: false }).where(eq(users.id, f.user.id));
    else if (boundary === "unverified auth")
      await h.db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, f.user.id));
    else
      await h.db
        .update(sessions)
        .set(
          boundary === "expired"
            ? { expiresAt: new Date(Date.now() - 1000) }
            : boundary === "revoked"
              ? { revokedAt: new Date() }
              : {
                  freshAuthenticatedAt: new Date(Date.now() - 86_400_000),
                  mfaVerifiedAt: new Date(Date.now() - 86_400_000),
                },
        )
        .where(eq(sessions.id, f.session.id));
    expect(await readUnchanged(f)).toEqual({ ok: false, error: "forbidden" });
  });

test("strict caseId-only selector rejects malformed and additional authority/evidence fields", async () => {
  const f = await reviewerCaseFixture(h);
  const selector = { caseId: f.privacyCase.id };
  for (const input of [
    null,
    {},
    [],
    f.privacyCase.id,
    { caseId: 42 },
    { caseId: "invalid" },
    { ...selector, subject: { kind: "user", referenceId: randomUUID() } },
    { ...selector, actor: { userId: f.user.id, sessionId: f.session.id } },
    { ...selector, userId: randomUUID() },
    { ...selector, sessionId: randomUUID() },
    { ...selector, expectedVersion: 1 },
    { ...selector, policyVersion: 1 },
    { ...selector, includeIdentityEvidence: true },
  ]) {
    expect(await readUnchanged(f, input)).toEqual({ ok: false, error: "invalid_input" });
  }
});

for (const damages of [
  ["ciphertext"],
  ["wrong case", "wrong purpose"],
  ["invalid JSON", "invalid root"],
  ["extra property", "invalid locale", "oversized summary"],
] as const)
  test(`${damages.join(" / ")} intake returns only bounded evidence_unavailable`, async () => {
    for (const damage of damages) {
      const f = await reviewerCaseFixture(h);
      const metadataEnc = damagedIntakeCiphertext(f, damage);
      await h.db
        .update(privacyCases)
        .set({ metadataEnc })
        .where(eq(privacyCases.id, f.privacyCase.id));
      const result = await readUnchanged(f);
      expect(result).toEqual({ ok: false, error: "evidence_unavailable" });
      expect(JSON.stringify(result)).not.toContain(PRIVATE_REVIEWER_CONTEXT);
    }
  });

test("denied authority cannot distinguish corrupt intake from a readable assigned request", async () => {
  const f = await reviewerCaseFixture(h);
  await h.db
    .update(privacyCases)
    .set({ metadataEnc: Buffer.from(PRIVATE_REVIEWER_CONTEXT) })
    .where(eq(privacyCases.id, f.privacyCase.id));
  await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
  expect(await readUnchanged(f)).toEqual({ ok: false, error: "forbidden" });
});

for (const column of ["received_at", "due_at"] as const)
  test(`native ${column} infinity returns static evidence_unavailable instead of ISO conversion failure`, async () => {
    const f = await reviewerCaseFixture(h);
    const id = randomUUID();
    const intakeKey = randomUUID();
    // Insert the non-finite receipt directly; its existing immutability trigger stays enabled.
    await h.db.insert(privacyCases).values({
      id,
      kind: "access",
      createdBy: f.user.id,
      intakeKey,
      intakeDigest: randomUUID(),
      metadataEnc: encryptPrivacy(JSON.stringify({ ...f.intake, intakeKey }), {
        caseId: id,
        purpose: "intake",
      }),
      receivedAt: column === "received_at" ? sql`'infinity'::timestamptz` : new Date(),
      dueAt: column === "due_at" ? sql`'infinity'::timestamptz` : null,
    });
    await h.db
      .insert(privacyCaseMembers)
      .values({ caseId: id, userId: f.user.id, capabilities: ["case.review"] });
    expect(await readUnchanged(f, { caseId: id })).toEqual({
      ok: false,
      error: "evidence_unavailable",
    });
  });

test("pre-abort preserves the original arbitrary reason and durable rows", async () => {
  const f = await reviewerCaseFixture(h);
  const before = await reviewerCaseSnapshot(h);
  const reason = Object.freeze({ cancellation: "synthetic-reviewer-context", nonce: randomUUID() });
  await expect(
    readPrivacyReviewerCase(h.db, f.actor, { caseId: f.privacyCase.id }, AbortSignal.abort(reason)),
  ).rejects.toBe(reason);
  expect(await reviewerCaseSnapshot(h)).toEqual(before);
});
