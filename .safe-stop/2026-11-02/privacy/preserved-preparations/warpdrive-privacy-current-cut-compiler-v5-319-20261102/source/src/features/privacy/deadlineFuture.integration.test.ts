import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { privacyCases, privacyDeadlineDecisions, privacyDeadlineRecords } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { bindPrivacyDeadline, extendPrivacyDeadlineRecord } from "./deadlineRecords";
import { activatePrivacyPolicy, savePrivacyPolicyDraft } from "./policy";
import { syntheticPolicyProfile } from "./policy.test-helpers";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("P05B/C13: a future notice cannot be recorded as already given to extend a deadline", async () => {
  const f = await authorityFixture(h, ["policy.manage", "case.review"]);
  const draft = await savePrivacyPolicyDraft(
    h.db,
    f.actor,
    { profile: syntheticPolicyProfile() },
    authoritySignal(),
  );
  assert(draft.ok);
  const active = await activatePrivacyPolicy(
    h.db,
    f.actor,
    {
      draftId: draft.value.id,
      expectedDraftRevision: 1,
      expectedActiveVersion: null,
      reviewReference: "synthetic-review",
      reason: "Synthetic reviewed policy",
    },
    authoritySignal(),
  );
  assert(active.ok);
  const bound = await bindPrivacyDeadline(
    h.db,
    f.actor,
    {
      caseId: f.privacyCase.id,
      policyVersion: 1,
      expectedCaseVersion: 1,
      commandId: "synthetic-bind",
    },
    authoritySignal(),
  );
  assert(bound.ok);
  expect(
    await extendPrivacyDeadlineRecord(
      h.db,
      f.actor,
      {
        caseId: f.privacyCase.id,
        expectedCaseVersion: 2,
        expectedDeadlineVersion: 1,
        commandId: "synthetic-future-notice",
        extension: {
          additionalMonths: 1,
          reason: "Synthetic extension",
          noticeReference: "not-yet-given",
          noticeRecordedAt: new Date(Date.now() + 86_400_000).toISOString(),
        },
      },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "notice_invalid" });
  const [record] = await h.db
    .select()
    .from(privacyDeadlineRecords)
    .where(eq(privacyDeadlineRecords.caseId, f.privacyCase.id));
  const [row] = await h.db.select().from(privacyCases).where(eq(privacyCases.id, f.privacyCase.id));
  expect(record?.version).toBe(1);
  expect(row?.version).toBe(2);
  expect(
    await h.db
      .select()
      .from(privacyDeadlineDecisions)
      .where(eq(privacyDeadlineDecisions.caseId, f.privacyCase.id)),
  ).toHaveLength(1);
});
