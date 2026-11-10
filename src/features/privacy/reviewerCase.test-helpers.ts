import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  persons,
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  privacyCaseVerifications,
  privacyPolicyDrafts,
  privacyPolicyState,
  privacyPolicyVersions,
  users,
} from "@/db/schema";
import type { TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import { encryptPrivacy } from "./crypto";
import { syntheticPolicyProfile } from "./policy.test-helpers";
import type { PrivacyReviewerCase } from "./reviewerCaseTypes";

export const PRIVATE_REVIEWER_CONTEXT = "SECRET-REVIEWER-CONTEXT-CREDENTIAL";

export async function reviewerCaseFixture(h: TestDb, verified = false) {
  const f = await authorityFixture(h, ["case.review"]);
  const request: PrivacyReviewerCase["request"] = {
    kind: "access",
    locale: "fa",
    subject: { kind: "external", description: "Synthetic original intake subject" },
    recipient: { channel: "email", address: "original-recipient@example.test" },
    summary: "SYNTHETIC-ORIGINAL-INTAKE-SUMMARY",
  };
  const intake = { intakeKey: f.privacyCase.intakeKey, ...request };
  await h.db
    .update(users)
    .set({ googleSub: `${PRIVATE_REVIEWER_CONTEXT}-${f.user.id}` })
    .where(eq(users.id, f.user.id));
  await h.db
    .update(privacyCases)
    .set({
      status: verified ? "under_review" : "verification_needed",
      verifiedAt: verified ? f.privacyCase.verifiedAt : null,
      metadataEnc: encryptPrivacy(JSON.stringify(intake), {
        caseId: f.privacyCase.id,
        purpose: "intake",
      }),
    })
    .where(eq(privacyCases.id, f.privacyCase.id));
  if (!verified)
    await h.db
      .delete(privacyCaseVerifications)
      .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
  const [privacyCase] = await h.db
    .select()
    .from(privacyCases)
    .where(eq(privacyCases.id, f.privacyCase.id));
  assert(privacyCase !== undefined);
  return { ...f, privacyCase, request, intake };
}
export type ReviewerCaseFixture = Awaited<ReturnType<typeof reviewerCaseFixture>>;

export async function reviewerCaseSnapshot(h: TestDb) {
  const result = await h.pool.query<{ state: unknown }>(`SELECT jsonb_build_object(
    'cases', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_cases t),
    'members', (SELECT jsonb_agg(t ORDER BY case_id,user_id) FROM privacy_case_members t),
    'proofs', (SELECT jsonb_agg(t ORDER BY case_id) FROM privacy_case_verifications t),
    'events', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_case_events t),
    'jobs', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_jobs t),
    'authority', (SELECT jsonb_agg(t ORDER BY user_id) FROM privacy_authority t),
    'policyState', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_policy_state t),
    'policyDrafts', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_policy_drafts t),
    'policyVersions', (SELECT jsonb_agg(t ORDER BY version) FROM privacy_policy_versions t),
    'deadlines', (SELECT jsonb_agg(t ORDER BY case_id) FROM privacy_deadline_records t),
    'deadlineDecisions', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_deadline_decisions t),
    'users', (SELECT jsonb_agg(t ORDER BY id) FROM users t),
    'auth', (SELECT jsonb_agg(t ORDER BY id) FROM auth_users t),
    'accounts', (SELECT jsonb_agg(t ORDER BY id) FROM auth_accounts t),
    'sessions', (SELECT jsonb_agg(t ORDER BY id) FROM sessions t),
    'persons', (SELECT jsonb_agg(t ORDER BY id) FROM persons t),
    'outbox', (SELECT jsonb_agg(t ORDER BY id) FROM auth_mail_outbox t)
  ) AS state`);
  assert(result.rows[0] !== undefined);
  return result.rows[0].state;
}

// This seeds an existing synthetic policy snapshot, not an activation through the reader.
export async function reviewerPolicyPointer(h: TestDb, f: ReviewerCaseFixture) {
  const id = randomUUID();
  const profile = JSON.stringify(syntheticPolicyProfile());
  await h.db.insert(privacyPolicyDrafts).values({
    id,
    createdBy: f.user.id,
    updatedBy: f.user.id,
    contentEnc: encryptPrivacy(profile, { caseId: `draft:${id}`, purpose: "policy" }),
  });
  await h.db.insert(privacyPolicyVersions).values({
    version: 1,
    draftId: id,
    draftRevision: 1,
    activatedBy: f.user.id,
    profileEnc: encryptPrivacy(profile, { caseId: "policy:1:profile", purpose: "policy" }),
    reviewEnc: encryptPrivacy("Synthetic prior review", {
      caseId: "policy:1:review",
      purpose: "policy",
    }),
  });
  await h.db
    .insert(privacyPolicyState)
    .values({ id: true, version: 1, generation: 4, updatedBy: f.user.id });
}

export async function denyReviewerRole(
  h: TestDb,
  f: ReviewerCaseFixture,
  role: "administrator" | "requester" | "record owner",
) {
  if (role === "administrator")
    await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, f.user.id));
  if (role === "requester")
    await h.db
      .update(privacyCases)
      .set({ requesterUserId: f.user.id })
      .where(eq(privacyCases.id, f.privacyCase.id));
  if (role === "record owner") {
    const [person] = await h.db
      .insert(persons)
      .values({
        name: "Synthetic owned source",
        ownerId: f.user.id,
        visibilityLevel: "owner",
      })
      .returning();
    assert(person !== undefined);
    await h.db
      .update(privacyCases)
      .set({
        metadataEnc: encryptPrivacy(
          JSON.stringify({
            ...f.intake,
            subject: { kind: "contact", referenceId: person.id },
          }),
          { caseId: f.privacyCase.id, purpose: "intake" },
        ),
      })
      .where(eq(privacyCases.id, f.privacyCase.id));
  }
  await h.db.delete(privacyAuthority).where(eq(privacyAuthority.userId, f.user.id));
  await h.db.delete(privacyCaseMembers).where(eq(privacyCaseMembers.caseId, f.privacyCase.id));
}
