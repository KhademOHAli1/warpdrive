import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { privacyPolicyDrafts, privacyPolicyState, privacyPolicyVersions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { ok } from "@/types/result";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { withPrivacyAuthority } from "./permissions";
import { activatePrivacyPolicy, readActivePrivacyPolicy, savePrivacyPolicyDraft } from "./policy";
import { syntheticPolicyProfile } from "./policy.test-helpers";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

async function draft(
  actor: { userId: string; sessionId: string },
  profile = syntheticPolicyProfile(),
) {
  const result = await savePrivacyPolicyDraft(h.db, actor, { profile }, authoritySignal());
  assert(result.ok);
  return result.value;
}

describe("P06A immutable reviewed controller policy revisions", () => {
  test("keeps unconfigured policy explicit and an incomplete encrypted draft cannot activate", async () => {
    const f = await authorityFixture(h, ["policy.manage"]);
    expect(await readActivePrivacyPolicy(h.db, f.actor, authoritySignal())).toEqual({
      ok: true,
      value: null,
    });
    const profile = syntheticPolicyProfile();
    const incomplete = {
      ...profile,
      controller: { ...profile.controller, identity: null },
      jurisdictions: [],
    };
    const saved = await savePrivacyPolicyDraft(
      h.db,
      f.actor,
      { profile: incomplete },
      authoritySignal(),
    );
    assert(saved.ok);
    const [stored] = await h.db
      .select()
      .from(privacyPolicyDrafts)
      .where(eq(privacyPolicyDrafts.id, saved.value.id));
    expect(stored?.contentEnc.toString()).not.toContain("Synthetic controller");
    expect(
      await activatePrivacyPolicy(
        h.db,
        f.actor,
        {
          draftId: saved.value.id,
          expectedDraftRevision: 1,
          expectedActiveVersion: null,
          reviewReference: "synthetic-review",
          reason: "Synthetic review decision",
        },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "policy_incomplete" });
    expect(await h.db.select().from(privacyPolicyVersions)).toHaveLength(0);
  });

  test("activates a complete reviewed profile without enabling CRM purge or broad disclosure", async () => {
    const f = await authorityFixture(h, ["policy.manage", "case.review"]);
    const saved = await draft(f.actor);
    const active = await activatePrivacyPolicy(
      h.db,
      f.actor,
      {
        draftId: saved.id,
        expectedDraftRevision: saved.revision,
        expectedActiveVersion: null,
        reviewReference: "synthetic-approved-review-1",
        reason: "Synthetic approved policy",
      },
      authoritySignal(),
    );
    assert(active.ok);
    expect(active.value.version).toBe(1);
    expect(active.value.profile).toMatchObject({
      retention: { activeCrm: { enabled: false } },
      rights: { disclosureEnabled: false },
    });
    const loaded = await readActivePrivacyPolicy(h.db, f.actor, authoritySignal());
    expect(loaded).toMatchObject({
      ok: true,
      value: { version: 1, profile: syntheticPolicyProfile() },
    });
    await expect(
      h.pool.query("UPDATE privacy_policy_versions SET version=2 WHERE version=1"),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      h.pool.query("DELETE FROM privacy_policy_versions WHERE version=1"),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("policy replacement invalidates earlier authority tickets without rewriting reviewed case policy", async () => {
    const f = await authorityFixture(h, ["policy.manage", "case.review"]);
    const original = await draft(f.actor);
    assert(
      (
        await activatePrivacyPolicy(
          h.db,
          f.actor,
          {
            draftId: original.id,
            expectedDraftRevision: 1,
            expectedActiveVersion: null,
            reviewReference: "synthetic-initial-review",
            reason: "Synthetic initial policy",
          },
          authoritySignal(),
        )
      ).ok,
    );
    const issued = await withPrivacyAuthority(
      h.db,
      f.actor,
      { capability: "case.review", caseId: f.privacyCase.id },
      authoritySignal(),
      (_tx, ticket) => Promise.resolve(ok(ticket)),
    );
    assert(issued.ok);
    const saved = await draft(f.actor);
    const activated = await activatePrivacyPolicy(
      h.db,
      f.actor,
      {
        draftId: saved.id,
        expectedDraftRevision: saved.revision,
        expectedActiveVersion: 1,
        reviewReference: "synthetic-approved-review-2",
        reason: "Synthetic policy replacement",
      },
      authoritySignal(),
    );
    assert(activated.ok);
    expect(activated.value.version).toBe(2);
    expect(
      await withPrivacyAuthority(
        h.db,
        f.actor,
        { capability: "case.review", caseId: f.privacyCase.id, expected: issued.value },
        authoritySignal(),
        () => Promise.resolve(ok(true)),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    const [state] = await h.db.select().from(privacyPolicyState);
    expect(state).toMatchObject({ version: 2, generation: 2 });
    expect(
      await h.pool.query("SELECT policy_version FROM privacy_cases WHERE id=$1", [
        f.privacyCase.id,
      ]),
    ).toMatchObject({ rows: [{ policy_version: null }] });
  });
});

describe("P06B policy authority, validation and concurrent activation", () => {
  test("administrator status without privacy policy authority cannot read or activate", async () => {
    const f = await authorityFixture(h, []);
    await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, f.user.id));
    expect(await readActivePrivacyPolicy(h.db, f.actor, authoritySignal())).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(
      await savePrivacyPolicyDraft(
        h.db,
        f.actor,
        { profile: syntheticPolicyProfile() },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
    expect(
      await activatePrivacyPolicy(
        h.db,
        f.actor,
        {
          draftId: randomUUID(),
          expectedDraftRevision: 1,
          expectedActiveVersion: null,
          reviewReference: "synthetic",
          reason: "Synthetic",
        },
        authoritySignal(),
      ),
    ).toEqual({ ok: false, error: "forbidden" });
  });

  test("unknown recipients, unreviewed disclosure and unreviewed purge stay inactive", async () => {
    const f = await authorityFixture(h, ["policy.manage"]);
    for (const changes of [
      { recipients: [{ ...syntheticPolicyProfile().recipients[0], locations: null }] },
      { rights: { disclosureEnabled: true, eligibilityReview: null } },
      {
        retention: {
          ...syntheticPolicyProfile().retention,
          activeCrm: { enabled: true, days: null, anchor: null, reviewReference: null },
        },
      },
    ]) {
      const saved = await savePrivacyPolicyDraft(
        h.db,
        f.actor,
        { profile: { ...syntheticPolicyProfile(), ...changes } },
        authoritySignal(),
      );
      assert(saved.ok);
      expect(
        await activatePrivacyPolicy(
          h.db,
          f.actor,
          {
            draftId: saved.value.id,
            expectedDraftRevision: 1,
            expectedActiveVersion: null,
            reviewReference: "synthetic",
            reason: "Synthetic",
          },
          authoritySignal(),
        ),
      ).toEqual({ ok: false, error: "policy_incomplete" });
    }
  });

  test("concurrent activations permit one exact expected version and preserve both drafts", async () => {
    const a = await authorityFixture(h, ["policy.manage"]);
    const b = await authorityFixture(h, ["policy.manage"]);
    const drafts = await Promise.all([draft(a.actor), draft(b.actor)]);
    const results = await Promise.all(
      [a, b].map((actor, index) =>
        activatePrivacyPolicy(
          h.db,
          actor.actor,
          {
            draftId: drafts[index]?.id,
            expectedDraftRevision: 1,
            expectedActiveVersion: null,
            reviewReference: `synthetic-${index}`,
            reason: "Synthetic concurrent activation",
          },
          authoritySignal(),
        ),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: "policy_conflict" },
    ]);
  });
});
