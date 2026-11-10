import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import { privacyCases, privacyCaseVerifications, privacyPolicyState } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authoritySignal } from "./authority.test-helpers";
import { privacyIntakeSchema } from "./caseSchemas";
import { encryptPrivacy } from "./crypto";
import { readPrivacyReviewerCase } from "./reviewerCase";
import {
  PRIVATE_REVIEWER_CONTEXT,
  type ReviewerCaseFixture,
  reviewerCaseFixture,
  reviewerCaseSnapshot,
  reviewerPolicyPointer,
} from "./reviewerCase.test-helpers";
import { privacyCaseStatusSchema } from "./states";

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

const proofVersionPatches = {
  scope: { scopeVersion: 2 },
  recipient: { recipientVersion: 2 },
  verification: { verificationVersion: 2 },
} as const;
type ProofDamage = "revoked" | "corrupt subject" | "corrupt recipient" | "corrupt evidence";
type ProofBoundary = "timestamp only" | keyof typeof proofVersionPatches | ProofDamage;

function proofDamagePatch(boundary: ProofDamage) {
  switch (boundary) {
    case "revoked":
      return { revokedAt: new Date() };
    case "corrupt subject":
      return { subjectEnc: Buffer.from(PRIVATE_REVIEWER_CONTEXT) };
    case "corrupt recipient":
      return { recipientEnc: Buffer.from(PRIVATE_REVIEWER_CONTEXT) };
    case "corrupt evidence":
      return { evidenceEnc: Buffer.from(PRIVATE_REVIEWER_CONTEXT) };
  }
}

async function applyProofBoundary(f: ReviewerCaseFixture, boundary: ProofBoundary) {
  if (boundary === "timestamp only") {
    await h.db
      .update(privacyCases)
      .set({ verifiedAt: new Date() })
      .where(eq(privacyCases.id, f.privacyCase.id));
    return;
  }
  if (boundary === "scope" || boundary === "recipient" || boundary === "verification") {
    await h.db
      .update(privacyCases)
      .set(proofVersionPatches[boundary])
      .where(eq(privacyCases.id, f.privacyCase.id));
    return;
  }
  await h.db
    .update(privacyCaseVerifications)
    .set(proofDamagePatch(boundary))
    .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
}

test("assigned ordinary reviewer reads exact original intake without proof, active policy or disclosure authority", async () => {
  const f = await reviewerCaseFixture(h);
  expect(f.user.isAdmin).toBe(false);
  const result = await readUnchanged(f);
  expect(result).toEqual({
    ok: true,
    value: {
      formatVersion: 1,
      case: {
        id: f.privacyCase.id,
        kind: "access",
        status: "verification_needed",
        version: 1,
        receivedAt: f.privacyCase.receivedAt.toISOString(),
        dueAt: null,
        policyVersion: null,
      },
      request: f.request,
      identity: { state: "review_required" },
      policy: { activeVersion: null, generation: 0 },
    },
  });
  assert(result.ok);
  expect(Object.keys(result.value).sort()).toEqual([
    "case",
    "formatVersion",
    "identity",
    "policy",
    "request",
  ]);
  expect(Object.keys(result.value.case).sort()).toEqual([
    "dueAt",
    "id",
    "kind",
    "policyVersion",
    "receivedAt",
    "status",
    "version",
  ]);
  expect(Object.keys(result.value.request).sort()).toEqual([
    "kind",
    "locale",
    "recipient",
    "subject",
    "summary",
  ]);
  expect(structuredClone(result)).toEqual(result);
  const encoded = JSON.stringify(result);
  for (const secret of [f.user.id, f.session.id, f.privacyCase.intakeKey, PRIVATE_REVIEWER_CONTEXT])
    expect(encoded).not.toContain(secret);
  expect(encoded).not.toMatch(
    /metadataEnc|subjectEnc|recipientEnc|createdBy|requesterUserId|tokenHash|commandId|intakeKey|profileEnc/,
  );
});

test("ISO due date and reviewed case policy remain distinct from the active policy ticket snapshot", async () => {
  const f = await reviewerCaseFixture(h);
  await reviewerPolicyPointer(h, f);
  const dueAt = new Date("2026-12-02T10:11:12.345Z");
  await h.db
    .update(privacyCases)
    .set({ dueAt, policyVersion: 8, version: 3 })
    .where(eq(privacyCases.id, f.privacyCase.id));
  expect(await readUnchanged(f)).toMatchObject({
    ok: true,
    value: {
      case: { dueAt: dueAt.toISOString(), policyVersion: 8, version: 3 },
      policy: { activeVersion: 1, generation: 4 },
      identity: { state: "review_required" },
    },
  });
});

test("an unconfigured existing policy pointer still preserves its generation", async () => {
  const f = await reviewerCaseFixture(h);
  await h.db.insert(privacyPolicyState).values({ id: true, version: null, generation: 7 });
  expect(await readUnchanged(f)).toMatchObject({
    ok: true,
    value: { policy: { activeVersion: null, generation: 7 } },
  });
});

test("current reviewed identity never replaces the original intake subject or recipient", async () => {
  const f = await reviewerCaseFixture(h, true);
  // Existing native proof binds the reviewer user and in-app recipient; intake is an external request.
  expect(await readUnchanged(f)).toMatchObject({
    ok: true,
    value: { request: f.request, identity: { state: "current" } },
  });
});

test("all declared workflow states remain readable without a transition side effect", async () => {
  const f = await reviewerCaseFixture(h);
  for (const status of privacyCaseStatusSchema.options) {
    await h.db.update(privacyCases).set({ status }).where(eq(privacyCases.id, f.privacyCase.id));
    expect(await readUnchanged(f)).toMatchObject({
      ok: true,
      value: { case: { status }, request: f.request },
    });
  }
});

test("all declared case kinds preserve the separate original intake kind", async () => {
  const f = await reviewerCaseFixture(h);
  for (const kind of privacyIntakeSchema.shape.kind.options) {
    await h.db.update(privacyCases).set({ kind }).where(eq(privacyCases.id, f.privacyCase.id));
    expect(await readUnchanged(f)).toMatchObject({
      ok: true,
      value: { case: { kind }, request: f.request },
    });
  }
});

test("FA/DE/EN original intake text is preserved without client identity inference", async () => {
  const f = await reviewerCaseFixture(h);
  for (const locale of ["fa", "de", "en"] as const) {
    const request = { ...f.request, locale, summary: "درخواست / Anfrage / Request" };
    await h.db
      .update(privacyCases)
      .set({
        metadataEnc: encryptPrivacy(
          JSON.stringify({
            intakeKey: f.privacyCase.intakeKey,
            ...request,
          }),
          { caseId: f.privacyCase.id, purpose: "intake" },
        ),
      })
      .where(eq(privacyCases.id, f.privacyCase.id));
    expect(await readUnchanged(f)).toMatchObject({ ok: true, value: { request } });
  }
});

for (const boundaries of [
  ["timestamp only"],
  ["scope", "recipient", "verification"],
  ["revoked"],
  ["corrupt subject", "corrupt recipient", "corrupt evidence"],
] as const)
  test(`${boundaries.join(" / ")} proof is review_required while intake remains readable`, async () => {
    for (const boundary of boundaries) {
      const f = await reviewerCaseFixture(h, boundary !== "timestamp only");
      await applyProofBoundary(f, boundary);
      expect(await readUnchanged(f)).toMatchObject({
        ok: true,
        value: { request: f.request, identity: { state: "review_required" } },
      });
    }
  });
