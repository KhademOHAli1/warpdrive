import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { authoritySignal } from "./authority.test-helpers";
import { DISCOVERY_COVERAGE } from "./discoveryCoverage";
import { loadPrivacyNativeSubjectReview } from "./nativeSubjectReview";
import {
  expectedNativeFingerprint,
  expectedNativeValues,
  reviewSnapshot,
  subjectReviewFixture,
} from "./nativeSubjectReview.test-helpers";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

for (const kind of ["contact", "user"] as const) {
  test(`P07/P08: loads only the verified ${kind} allowlist, without ownership or same-address expansion`, async () => {
    const f = await subjectReviewFixture(h, kind);
    const before = await reviewSnapshot(h, f);
    const result = await loadPrivacyNativeSubjectReview(
      h.db,
      f.reviewer.actor,
      { caseId: f.privacyCase.id },
      authoritySignal(),
    );
    expect(result.ok).toBe(true);
    assert(result.ok, "expected a preliminary native subject review");
    expect(Object.keys(result.value).sort()).toEqual([
      "binding",
      "complete",
      "coverage",
      "formatVersion",
      "record",
      "reviewRequired",
      "state",
    ]);
    expect(result.value).toMatchObject({
      formatVersion: 1,
      state: "preliminary",
      complete: false,
      reviewRequired: true,
    });
    expect(result.value.binding).toEqual({
      caseId: f.privacyCase.id,
      caseVersion: f.privacyCase.version,
      subject: f.subject,
      identityScopeVersion: f.privacyCase.scopeVersion,
      recipientVersion: f.privacyCase.recipientVersion,
      verificationVersion: f.privacyCase.verificationVersion,
      policyVersion: 1,
      policyGeneration: 1,
    });
    expect(result.value.record).toMatchObject({
      adapterVersion: 1,
      recordId: f.subject.referenceId,
      store: kind === "contact" ? "persons" : "users",
      recordType: kind === "contact" ? "person" : "user",
      values: expectedNativeValues(f),
      sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(Object.keys(result.value.record).sort()).toEqual([
      "adapterVersion",
      "recordId",
      "recordType",
      "sourceFingerprint",
      "store",
      "values",
    ]);
    expect(result.value.record.values).toEqual(expectedNativeValues(f));
    expect(result.value.record.sourceFingerprint).toBe(expectedNativeFingerprint(f));
    const encoded = JSON.stringify(result);
    expect(encoded).not.toMatch(
      /SECRET-|PRIVATE-|UNRELATED-|ownerId|customFields|googleSub|avatarUrl|tokenHash|password|accessToken|refreshToken|isAdmin|emailVerified|approved|approvalId|exportToken|scopeApproved/,
    );
    for (const id of [f.owner.id, f.reviewer.user.id, f.shared.id, f.owned.id]) {
      expect(JSON.stringify(result.value.record)).not.toContain(id);
    }
    expect(await reviewSnapshot(h, f)).toEqual(before);
  });

  test(`P07: ${kind} review retains every declared category as unresolved`, async () => {
    const f = await subjectReviewFixture(h, kind);
    const result = await loadPrivacyNativeSubjectReview(
      h.db,
      f.reviewer.actor,
      { caseId: f.privacyCase.id },
      authoritySignal(),
    );
    assert(result.ok);
    const stores = result.value.coverage.map((entry) => entry.store);
    const expected = [
      ...DISCOVERY_COVERAGE.map((entry) => entry.store),
      "pgboss-managed-schema",
      "object_versions_providers_backups",
      "reviewed_scope",
    ];
    expect([...stores].sort()).toEqual([...new Set(expected)].sort());
    expect(new Set(stores).size).toBe(stores.length);
    for (const entry of result.value.coverage) {
      expect(["incomplete", "unsupported"]).toContain(entry.status);
      expect(["direct_subject_only", "not_loaded", "adapter_unavailable"]).toContain(entry.code);
    }
    expect(result.value.coverage).toContainEqual({
      store: kind === "contact" ? "persons" : "users",
      status: "incomplete",
      code: "direct_subject_only",
    });
    expect(result.value.coverage).toContainEqual({
      store: "auth_accounts",
      status: "unsupported",
      code: "adapter_unavailable",
    });
  });

  test(`P08: ${kind} source fingerprints are stable and change on a native projected edit without timestamp help`, async () => {
    const f = await subjectReviewFixture(h, kind);
    const input = { caseId: f.privacyCase.id };
    const first = await loadPrivacyNativeSubjectReview(
      h.db,
      f.reviewer.actor,
      input,
      authoritySignal(),
    );
    const repeat = await loadPrivacyNativeSubjectReview(
      h.db,
      f.reviewer.actor,
      input,
      authoritySignal(),
    );
    assert(first.ok && repeat.ok);
    expect(repeat.value.record.sourceFingerprint).toBe(first.value.record.sourceFingerprint);
    if (kind === "contact")
      await h.pool.query("UPDATE persons SET name=$1 WHERE id=$2", [
        "Changed verified contact",
        f.contact.id,
      ]);
    else
      await h.pool.query("UPDATE users SET name=$1 WHERE id=$2", [
        "Changed verified workforce subject",
        f.workforce.id,
      ]);
    const before = await reviewSnapshot(h, f);
    const changed = await loadPrivacyNativeSubjectReview(
      h.db,
      f.reviewer.actor,
      input,
      authoritySignal(),
    );
    assert(changed.ok);
    expect(changed.value.record.sourceFingerprint).not.toBe(first.value.record.sourceFingerprint);
    expect(changed.value.record.values.name).toBe(
      kind === "contact" ? "Changed verified contact" : "Changed verified workforce subject",
    );
    expect(changed.value.record.values.updatedAt).toBe(first.value.record.values.updatedAt);
    expect(await reviewSnapshot(h, f)).toEqual(before);
  });
}

test("P08: excluded free JSON, security and unrelated edits do not enter the safe projection fingerprint", async () => {
  const f = await subjectReviewFixture(h);
  const input = { caseId: f.privacyCase.id };
  const first = await loadPrivacyNativeSubjectReview(
    h.db,
    f.reviewer.actor,
    input,
    authoritySignal(),
  );
  assert(first.ok);
  await h.pool.query("UPDATE persons SET custom_fields=$1::jsonb WHERE id=$2", [
    JSON.stringify({ secret: "NEW-PRIVATE-FREE-JSON" }),
    f.contact.id,
  ]);
  await h.pool.query("UPDATE persons SET name=$1 WHERE id=$2", ["NEW-UNRELATED-ROW", f.owned.id]);
  await h.pool.query("UPDATE auth_accounts SET access_token=$1 WHERE user_id=$2", [
    "NEW-SECRET-TOKEN",
    f.workforce.id,
  ]);
  const next = await loadPrivacyNativeSubjectReview(
    h.db,
    f.reviewer.actor,
    input,
    authoritySignal(),
  );
  assert(next.ok);
  expect(next.value.record).toEqual(first.value.record);
});

test("C01: only caseId is accepted; caller-selected identity, approval, hashes and coverage are rejected", async () => {
  const f = await subjectReviewFixture(h);
  const valid = { caseId: f.privacyCase.id };
  const before = await reviewSnapshot(h, f);
  for (const input of [
    null,
    {},
    { caseId: "invalid" },
    { ...valid, subjectId: randomUUID() },
    { ...valid, subject: { kind: "user", referenceId: f.reviewer.user.id } },
    { ...valid, sourceFingerprint: "a".repeat(64) },
    { ...valid, scopeApproved: true },
    { ...valid, coverage: [] },
  ])
    expect(
      await loadPrivacyNativeSubjectReview(h.db, f.reviewer.actor, input, authoritySignal()),
    ).toEqual({ ok: false, error: "invalid_input" });
  expect(await reviewSnapshot(h, f)).toEqual(before);
});

test("C06: pre-abort preserves the exact original reason without mutating durable/source rows", async () => {
  const f = await subjectReviewFixture(h);
  const before = await reviewSnapshot(h, f);
  const controller = new AbortController();
  const reason = Object.freeze({
    reason: "synthetic native review cancellation",
    nonce: randomUUID(),
  });
  controller.abort(reason);
  await expect(
    loadPrivacyNativeSubjectReview(
      h.db,
      f.reviewer.actor,
      { caseId: f.privacyCase.id },
      controller.signal,
    ),
  ).rejects.toBe(reason);
  expect(await reviewSnapshot(h, f)).toEqual(before);
});
