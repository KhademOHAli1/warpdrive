import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  privacyCaseVerifications,
  privacyPolicyState,
  sessions,
  users,
} from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { loadPrivacyNativeSubjectReview } from "./nativeSubjectReview";
import {
  activateSubjectPolicy,
  reviewSnapshot,
  type SubjectReviewFixture,
  subjectReviewFixture,
} from "./nativeSubjectReview.test-helpers";
import { privacyCaseStatusSchema } from "./states";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});
async function deny(f: SubjectReviewFixture, error: string) {
  const before = await reviewSnapshot(h, f);
  expect(
    await loadPrivacyNativeSubjectReview(
      h.db,
      f.reviewer.actor,
      { caseId: f.privacyCase.id },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error });
  expect(await reviewSnapshot(h, f)).toEqual(before);
}
const member = (f: SubjectReviewFixture) =>
  and(
    eq(privacyCaseMembers.caseId, f.privacyCase.id),
    eq(privacyCaseMembers.userId, f.reviewer.user.id),
  );

for (const boundary of ["scope", "recipient", "verification", "revoked proof"] as const)
  test(`C03: stale ${boundary} binding denies without source fields`, async () => {
    const f = await subjectReviewFixture(h);
    if (boundary === "scope")
      await h.db
        .update(privacyCases)
        .set({ scopeVersion: f.privacyCase.scopeVersion + 1 })
        .where(eq(privacyCases.id, f.privacyCase.id));
    else if (boundary === "recipient")
      await h.db
        .update(privacyCases)
        .set({ recipientVersion: f.privacyCase.recipientVersion + 1 })
        .where(eq(privacyCases.id, f.privacyCase.id));
    else if (boundary === "verification")
      await h.db
        .update(privacyCases)
        .set({ verificationVersion: f.privacyCase.verificationVersion + 1 })
        .where(eq(privacyCases.id, f.privacyCase.id));
    else
      await h.db
        .update(privacyCaseVerifications)
        .set({ revokedAt: new Date() })
        .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
    await deny(f, "forbidden");
  });

for (const boundary of [
  "global disclose",
  "global review",
  "member disclose",
  "member review",
  "revoked membership",
  "admin only",
] as const)
  test(`C01/C02: ${boundary} never bypasses both explicit privacy capabilities`, async () => {
    const f = await subjectReviewFixture(h);
    expect(
      (
        await loadPrivacyNativeSubjectReview(
          h.db,
          f.reviewer.actor,
          { caseId: f.privacyCase.id },
          authoritySignal(),
        )
      ).ok,
    ).toBe(true);
    if (boundary === "global disclose")
      await h.db
        .update(privacyAuthority)
        .set({ capabilities: ["case.review"], generation: 2 })
        .where(eq(privacyAuthority.userId, f.reviewer.user.id));
    else if (boundary === "global review")
      await h.db
        .update(privacyAuthority)
        .set({ capabilities: ["case.disclose"], generation: 2 })
        .where(eq(privacyAuthority.userId, f.reviewer.user.id));
    else if (boundary === "member disclose")
      await h.db
        .update(privacyCaseMembers)
        .set({ capabilities: ["case.review"], generation: 2 })
        .where(member(f));
    else if (boundary === "member review")
      await h.db
        .update(privacyCaseMembers)
        .set({ capabilities: ["case.disclose"], generation: 2 })
        .where(member(f));
    else if (boundary === "revoked membership")
      await h.db
        .update(privacyCaseMembers)
        .set({ revokedAt: new Date(), generation: 2 })
        .where(member(f));
    else {
      await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, f.reviewer.user.id));
      await h.db
        .update(privacyAuthority)
        .set({ capabilities: [], generation: 2 })
        .where(eq(privacyAuthority.userId, f.reviewer.user.id));
      await h.db
        .update(privacyCaseMembers)
        .set({ capabilities: [], generation: 2 })
        .where(member(f));
    }
    await deny(f, "forbidden");
  });

test("C01: a current reviewer on another case has no membership-derived access", async () => {
  const f = await subjectReviewFixture(h);
  const other = await authorityFixture(h, ["case.review", "case.disclose"]);
  const before = await reviewSnapshot(h, f);
  expect(
    await loadPrivacyNativeSubjectReview(
      h.db,
      other.actor,
      { caseId: f.privacyCase.id },
      authoritySignal(),
    ),
  ).toEqual({ ok: false, error: "forbidden" });
  expect(await reviewSnapshot(h, f)).toEqual(before);
});

for (const boundary of [
  "no active policy",
  "unreviewed case policy",
  "replaced active policy",
  "disabled disclosure",
] as const)
  test(`P06/C03: ${boundary} denies preliminary source loading`, async () => {
    const f = await subjectReviewFixture(h);
    if (boundary === "no active policy") {
      await h.db.update(privacyPolicyState).set({ version: null, generation: 2 });
      await deny(f, "policy_unconfigured");
    } else if (boundary === "unreviewed case policy") {
      await h.db
        .update(privacyCases)
        .set({ policyVersion: null })
        .where(eq(privacyCases.id, f.privacyCase.id));
      await deny(f, "policy_stale");
    } else if (boundary === "replaced active policy") {
      await activateSubjectPolicy(h, f.reviewer.actor, true);
      await deny(f, "policy_stale");
    } else {
      const version = await activateSubjectPolicy(h, f.reviewer.actor, false);
      await h.db
        .update(privacyCases)
        .set({ policyVersion: version })
        .where(eq(privacyCases.id, f.privacyCase.id));
      await deny(f, "policy_disabled");
    }
  });

for (const status of privacyCaseStatusSchema.options.filter((value) => value !== "under_review"))
  test(`C01: ${status} cannot expose a previously verified source`, async () => {
    const f = await subjectReviewFixture(h);
    await h.db.update(privacyCases).set({ status }).where(eq(privacyCases.id, f.privacyCase.id));
    await deny(f, "case_not_reviewable");
  });

for (const kind of ["correction", "restriction", "objection", "closure", "erasure"] as const)
  test(`C01: ${kind} does not enter the access/portability native review slice`, async () => {
    const f = await subjectReviewFixture(h);
    await h.db.update(privacyCases).set({ kind }).where(eq(privacyCases.id, f.privacyCase.id));
    await deny(f, "case_not_reviewable");
  });

test("P08: a verified portability case can load preliminary values without portability approval", async () => {
  const f = await subjectReviewFixture(h);
  await h.db
    .update(privacyCases)
    .set({ kind: "portability" })
    .where(eq(privacyCases.id, f.privacyCase.id));
  const before = await reviewSnapshot(h, f);
  const result = await loadPrivacyNativeSubjectReview(
    h.db,
    f.reviewer.actor,
    { caseId: f.privacyCase.id },
    authoritySignal(),
  );
  expect(result).toMatchObject({
    ok: true,
    value: {
      state: "preliminary",
      complete: false,
      reviewRequired: true,
      record: { store: "persons", recordId: f.contact.id },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/approvalId|scopeApproved|exportToken/);
  expect(await reviewSnapshot(h, f)).toEqual(before);
});

for (const kind of ["contact", "user"] as const)
  test(`P07: an absent verified ${kind} never falls back to owner, auth identity or shared email`, async () => {
    const f = await subjectReviewFixture(h, kind);
    if (kind === "contact") await h.pool.query("DELETE FROM persons WHERE id=$1", [f.contact.id]);
    else {
      await h.pool.query("DELETE FROM auth_accounts WHERE user_id=$1", [f.workforce.id]);
      await h.pool.query("DELETE FROM auth_users WHERE id=$1", [f.workforce.id]);
      await h.pool.query("DELETE FROM users WHERE id=$1", [f.workforce.id]);
    }
    await deny(f, "source_unavailable");
  });

test("C02: an expired current reviewer session denies a previously readable subject", async () => {
  const f = await subjectReviewFixture(h);
  expect(
    (
      await loadPrivacyNativeSubjectReview(
        h.db,
        f.reviewer.actor,
        { caseId: f.privacyCase.id },
        authoritySignal(),
      )
    ).ok,
  ).toBe(true);
  await h.db
    .update(sessions)
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where(eq(sessions.id, f.reviewer.session.id));
  await deny(f, "forbidden");
});

for (const boundary of [
  "oversize user text",
  "oversize contact points",
  "malformed contact points",
] as const)
  test(`C11: ${boundary} fails without returning partial or unvalidated source values`, async () => {
    const f = await subjectReviewFixture(h, boundary === "oversize user text" ? "user" : "contact");
    if (boundary === "oversize user text") {
      await h.pool.query("UPDATE users SET name=repeat('x',1048577) WHERE id=$1", [f.workforce.id]);
      await deny(f, "source_limit");
    } else {
      const emails =
        boundary === "oversize contact points"
          ? Array.from({ length: 1001 }, () => ({
              label: "synthetic",
              value: "synthetic@example.test",
            }))
          : [
              {
                label: "synthetic",
                value: "synthetic@example.test",
                secret: "SECRET-UNVALIDATED-POINT",
              },
            ];
      await h.pool.query("UPDATE persons SET emails=$1::jsonb WHERE id=$2", [
        JSON.stringify(emails),
        f.contact.id,
      ]);
      await deny(f, boundary === "oversize contact points" ? "source_limit" : "source_invalid");
    }
  });
