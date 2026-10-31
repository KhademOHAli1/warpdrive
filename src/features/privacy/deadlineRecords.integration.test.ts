import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  privacyCaseEvents,
  privacyCaseMembers,
  privacyCases,
  privacyDeadlineDecisions,
  privacyDeadlineRecords,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { decryptPrivacy } from "./crypto";
import { bindPrivacyDeadline, extendPrivacyDeadlineRecord } from "./deadlineRecords";
import { activatePrivacyPolicy, savePrivacyPolicyDraft } from "./policy";
import { syntheticPolicyProfile } from "./policy.test-helpers";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

async function fixture() {
  const actor = await authorityFixture(h, ["policy.manage", "case.review"]);
  const draft = await savePrivacyPolicyDraft(
    h.db,
    actor.actor,
    { profile: syntheticPolicyProfile() },
    authoritySignal(),
  );
  assert(draft.ok);
  const active = await activatePrivacyPolicy(
    h.db,
    actor.actor,
    {
      draftId: draft.value.id,
      expectedDraftRevision: 1,
      expectedActiveVersion: null,
      reviewReference: "synthetic-policy-review",
      reason: "Synthetic test policy",
    },
    authoritySignal(),
  );
  assert(active.ok);
  const [privacyCase] = await h.db
    .insert(privacyCases)
    .values({
      kind: "access",
      status: "under_review",
      verifiedAt: new Date(),
      createdBy: actor.user.id,
      intakeKey: randomUUID(),
      intakeDigest: "synthetic",
      metadataEnc: Buffer.alloc(0),
      receivedAt: new Date("2026-01-31T15:00:00Z"),
    })
    .returning();
  assert(privacyCase !== undefined);
  await h.db
    .insert(privacyCaseMembers)
    .values({ caseId: privacyCase.id, userId: actor.user.id, capabilities: ["case.review"] });
  return { ...actor, privacyCase };
}

const extension = {
  additionalMonths: 1,
  reason: "SYNTHETIC_ENCRYPTED_EXTENSION_REASON",
  noticeReference: "SYNTHETIC_ENCRYPTED_NOTICE_REFERENCE",
  noticeRecordedAt: "2026-02-20T10:00:00Z",
};

describe("P05A/P05B durable deadline decisions", () => {
  test("rolls back deadline, case and receipt writes after a real event constraint failure", async () => {
    const f = await fixture();
    const initial = await bindPrivacyDeadline(
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
    assert(initial.ok);
    await h.pool.query(`CREATE FUNCTION synthetic_reject_deadline_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'SYNTHETIC_SECRET_DRIVER_SENTINEL' USING ERRCODE='23514'; END; $$`);
    await h.pool.query(`CREATE TRIGGER synthetic_deadline_constraint BEFORE INSERT ON privacy_case_events
      FOR EACH ROW WHEN (NEW.action='deadline_extended') EXECUTE FUNCTION synthetic_reject_deadline_event()`);
    expect(
      await extendPrivacyDeadlineRecord(
        h.db,
        f.actor,
        {
          caseId: f.privacyCase.id,
          expectedCaseVersion: 2,
          expectedDeadlineVersion: 1,
          commandId: "synthetic-extension",
          extension,
        },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "storage_unavailable" });
    const [record] = await h.db.select().from(privacyDeadlineRecords);
    expect(record).toMatchObject({
      version: 1,
      extensionMonths: 0,
      dueAt: new Date("2026-02-28T15:00:00Z"),
    });
    const [privacyCase] = await h.db
      .select()
      .from(privacyCases)
      .where(eq(privacyCases.id, f.privacyCase.id));
    expect(privacyCase).toMatchObject({ version: 2, dueAt: new Date("2026-02-28T15:00:00Z") });
    expect(await h.db.select().from(privacyDeadlineDecisions)).toHaveLength(1);
  });

  test("binds original receipt and exact policy, persists encrypted extension evidence and keeps minimal events", async () => {
    const f = await fixture();
    const initial = await bindPrivacyDeadline(
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
    assert(initial.ok);
    expect(initial.value).toMatchObject({
      caseVersion: 2,
      recordVersion: 1,
      deadline: { receivedAt: "2026-01-31T15:00:00.000Z", dueAt: "2026-02-28T15:00:00.000Z" },
    });
    const updated = await extendPrivacyDeadlineRecord(
      h.db,
      f.actor,
      {
        caseId: f.privacyCase.id,
        expectedCaseVersion: 2,
        expectedDeadlineVersion: 1,
        commandId: "synthetic-extension",
        extension,
      },
      authoritySignal(),
    );
    assert(updated.ok);
    expect(updated.value).toMatchObject({
      caseVersion: 3,
      recordVersion: 2,
      deadline: {
        receivedAt: "2026-01-31T15:00:00.000Z",
        originalDueAt: "2026-02-28T15:00:00.000Z",
        dueAt: "2026-03-31T14:00:00.000Z",
      },
    });
    const [record] = await h.db
      .select()
      .from(privacyDeadlineRecords)
      .where(eq(privacyDeadlineRecords.caseId, f.privacyCase.id));
    assert(record !== undefined);
    expect(record.snapshotEnc.toString()).not.toContain(extension.reason);
    const decrypted = decryptPrivacy(record.snapshotEnc, {
      caseId: f.privacyCase.id,
      purpose: "decision",
    });
    assert(decrypted.ok);
    expect(decrypted.value).toContain(extension.reason);
    const decisions = await h.db.select().from(privacyDeadlineDecisions);
    expect(decisions).toHaveLength(2);
    expect(JSON.stringify(decisions)).not.toContain(extension.noticeReference);
    const events = await h.db
      .select()
      .from(privacyCaseEvents)
      .where(eq(privacyCaseEvents.caseId, f.privacyCase.id));
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(extension.reason);
    await expect(
      h.pool.query("UPDATE privacy_deadline_records SET received_at=now() WHERE case_id=$1", [
        f.privacyCase.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.pool.query("UPDATE privacy_deadline_decisions SET command_id='changed' WHERE case_id=$1", [
        f.privacyCase.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("replays identical commands without duplicate decisions and refuses conflicting or stale extensions", async () => {
    const f = await fixture();
    const bind = {
      caseId: f.privacyCase.id,
      policyVersion: 1,
      expectedCaseVersion: 1,
      commandId: "synthetic-bind",
    };
    const initial = await bindPrivacyDeadline(h.db, f.actor, bind, authoritySignal());
    assert(initial.ok);
    expect(await bindPrivacyDeadline(h.db, f.actor, bind, authoritySignal())).toEqual(initial);
    const input = {
      caseId: f.privacyCase.id,
      expectedCaseVersion: 2,
      expectedDeadlineVersion: 1,
      commandId: "synthetic-extension",
      extension,
    };
    const results = await Promise.all([
      extendPrivacyDeadlineRecord(h.db, f.actor, input, authoritySignal()),
      extendPrivacyDeadlineRecord(h.db, f.actor, input, authoritySignal()),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]?.ok).toBe(true);
    expect(
      await extendPrivacyDeadlineRecord(
        h.db,
        f.actor,
        { ...input, extension: { ...extension, reason: "Changed" } },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "command_conflict" });
    expect(
      await extendPrivacyDeadlineRecord(
        h.db,
        f.actor,
        { ...input, commandId: "stale-extension" },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "case_conflict" });
    expect(await h.db.select().from(privacyDeadlineDecisions)).toHaveLength(2);
  });

  test("unrelated actors, inactive policy binding and invalid notices have no effect", async () => {
    const f = await fixture();
    const other = await authorityFixture(h, ["case.review"]);
    const input = {
      caseId: f.privacyCase.id,
      policyVersion: 1,
      expectedCaseVersion: 1,
      commandId: "synthetic-bind",
    };
    expect(await bindPrivacyDeadline(h.db, other.actor, input, authoritySignal())).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await bindPrivacyDeadline(h.db, f.actor, { ...input, policyVersion: 99 }, authoritySignal()),
    ).toEqual({ ok: false, error: "policy_conflict" });
    const bound = await bindPrivacyDeadline(h.db, f.actor, input, authoritySignal());
    assert(bound.ok);
    for (const changes of [
      { reason: " " },
      { noticeReference: " " },
      { noticeRecordedAt: "2026-03-01T10:00:00Z" },
    ]) {
      expect(
        (
          await extendPrivacyDeadlineRecord(
            h.db,
            f.actor,
            {
              caseId: f.privacyCase.id,
              expectedCaseVersion: 2,
              expectedDeadlineVersion: 1,
              commandId: randomUUID(),
              extension: { ...extension, ...changes },
            },
            authoritySignal(),
          )
        ).ok,
      ).toBe(false);
    }
    expect(await h.db.select().from(privacyDeadlineDecisions)).toHaveLength(1);
    const [privacyCase] = await h.db
      .select()
      .from(privacyCases)
      .where(eq(privacyCases.id, f.privacyCase.id));
    expect(privacyCase).toMatchObject({
      version: 2,
      receivedAt: new Date("2026-01-31T15:00:00Z"),
      dueAt: new Date("2026-02-28T15:00:00Z"),
    });
  });
});
