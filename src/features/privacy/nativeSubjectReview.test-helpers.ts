import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  authAccounts,
  authUsers,
  persons,
  privacyCases,
  privacyPolicyState,
  users,
} from "@/db/schema";
import type { TestDb } from "@/test/db";
import { authorityFixture, authoritySignal } from "./authority.test-helpers";
import { fingerprintPrivacy } from "./crypto";
import { verifyPrivacyCaseIdentity } from "./identityReview";
import { activatePrivacyPolicy, savePrivacyPolicyDraft } from "./policy";
import { syntheticPolicyProfile } from "./policy.test-helpers";
import { canonicalScopeJson } from "./scopeDraftCanonical";

export async function subjectReviewFixture(h: TestDb, kind: "contact" | "user" = "contact") {
  const reviewer = await authorityFixture(h, ["case.review", "case.disclose", "policy.manage"]);
  const [owner] = await h.db
    .insert(users)
    .values({
      name: "UNRELATED-RECORD-OWNER",
      email: `owner-${randomUUID()}@example.test`,
    })
    .returning();
  const [workforce] = await h.db
    .insert(users)
    .values({
      name: "Synthetic workforce subject",
      email: `subject-${randomUUID()}@example.test`,
      avatarUrl: "PRIVATE-AVATAR",
      googleSub: `PRIVATE-GOOGLE-${randomUUID()}`,
    })
    .returning();
  assert(owner !== undefined && workforce !== undefined);
  await h.db.insert(authUsers).values({
    id: workforce.id,
    name: "PRIVATE-AUTH-IDENTITY-NAME",
    email: workforce.email,
    emailVerified: true,
  });
  await h.db.insert(authAccounts).values({
    userId: workforce.id,
    providerId: "credential",
    accountId: randomUUID(),
    password: "SECRET-PASSWORD",
    accessToken: "SECRET-ACCESS-TOKEN",
    refreshToken: "SECRET-REFRESH-TOKEN",
  });
  const [contact, shared, owned] = await h.db
    .insert(persons)
    .values([
      {
        name: "Synthetic verified contact",
        firstName: "Synthetic",
        lastName: "Contact",
        primaryEmail: workforce.email,
        emails: [{ label: "work", value: workforce.email, primary: true }],
        phones: [{ label: "work", value: "+000000000" }],
        ownerId: owner.id,
        visibilityLevel: "owner" as const,
        customFields: { private: "PRIVATE-FREE-JSON", credential: "SECRET-CUSTOM-CREDENTIAL" },
      },
      {
        name: "UNRELATED-SHARED-ADDRESS",
        primaryEmail: workforce.email,
        ownerId: reviewer.user.id,
        visibilityLevel: "all" as const,
      },
      { name: "UNRELATED-OWNED-ROW", ownerId: reviewer.user.id, visibilityLevel: "all" as const },
    ])
    .returning();
  assert(contact !== undefined && shared !== undefined && owned !== undefined);
  const subject = { kind, referenceId: kind === "contact" ? contact.id : workforce.id };
  const verified = await verifyPrivacyCaseIdentity(
    h.db,
    reviewer.actor,
    {
      caseId: reviewer.privacyCase.id,
      expectedVersion: 1,
      commandId: randomUUID(),
      subject,
      recipient: { channel: "email", address: `recipient-${randomUUID()}@example.test` },
      evidence: {
        trustedChannel: "organizational_record",
        evidenceRef: "synthetic-native-review-proof",
        observedAt: new Date().toISOString(),
        confirmedSubject: true,
        confirmedRecipient: true,
      },
    },
    authoritySignal(),
  );
  assert(verified.ok, "synthetic native identity verification failed");
  const active = await activateSubjectPolicy(h, reviewer.actor, true);
  await h.db
    .update(privacyCases)
    .set({ policyVersion: active })
    .where(eq(privacyCases.id, subjectCaseId(reviewer)));
  const [privacyCase] = await h.db
    .select()
    .from(privacyCases)
    .where(eq(privacyCases.id, subjectCaseId(reviewer)));
  assert(privacyCase !== undefined);
  return { reviewer, owner, workforce, contact, shared, owned, subject, privacyCase };
}
function subjectCaseId(reviewer: Awaited<ReturnType<typeof authorityFixture>>) {
  return reviewer.privacyCase.id;
}
export type SubjectReviewFixture = Awaited<ReturnType<typeof subjectReviewFixture>>;

export async function activateSubjectPolicy(
  h: TestDb,
  actor: { userId: string; sessionId: string },
  enabled: boolean,
) {
  const [state] = await h.db.select().from(privacyPolicyState);
  const profile = syntheticPolicyProfile();
  const saved = await savePrivacyPolicyDraft(
    h.db,
    actor,
    {
      profile: {
        ...profile,
        rights: {
          disclosureEnabled: enabled,
          eligibilityReview: enabled ? "synthetic-disclosure-review" : null,
        },
      },
    },
    authoritySignal(),
  );
  assert(saved.ok);
  const active = await activatePrivacyPolicy(
    h.db,
    actor,
    {
      draftId: saved.value.id,
      expectedDraftRevision: saved.value.revision,
      expectedActiveVersion: state?.version ?? null,
      reviewReference: "synthetic-policy-review",
      reason: "Synthetic native reviewer fixture policy",
    },
    authoritySignal(),
  );
  assert(active.ok);
  return active.value.version;
}

export function expectedNativeValues(f: SubjectReviewFixture) {
  if (f.subject.kind === "user")
    return {
      id: f.workforce.id,
      name: f.workforce.name,
      email: f.workforce.email,
      createdAt: f.workforce.createdAt.toISOString(),
      updatedAt: f.workforce.updatedAt.toISOString(),
    };
  return {
    id: f.contact.id,
    name: f.contact.name,
    firstName: f.contact.firstName,
    lastName: f.contact.lastName,
    primaryEmail: f.contact.primaryEmail,
    emails: f.contact.emails,
    phones: f.contact.phones,
    createdAt: f.contact.createdAt.toISOString(),
    updatedAt: f.contact.updatedAt.toISOString(),
    deletedAt: null,
  };
}

export async function reviewSnapshot(h: TestDb, f: SubjectReviewFixture) {
  const result = await h.pool.query<{ state: unknown }>(
    `SELECT jsonb_build_object(
    'cases', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_cases t),
    'proofs', (SELECT jsonb_agg(t ORDER BY case_id) FROM privacy_case_verifications t),
    'events', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_case_events t),
    'jobs', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_jobs t),
    'members', (SELECT jsonb_agg(t ORDER BY case_id,user_id) FROM privacy_case_members t),
    'authority', (SELECT jsonb_agg(t ORDER BY user_id) FROM privacy_authority t),
    'policy', (SELECT jsonb_agg(t ORDER BY id) FROM privacy_policy_state t),
    'users', (SELECT jsonb_agg(t ORDER BY id) FROM users t),
    'auth', (SELECT jsonb_agg(t ORDER BY id) FROM auth_users t),
    'accounts', (SELECT jsonb_agg(t ORDER BY id) FROM auth_accounts t),
    'sessions', (SELECT jsonb_agg(t ORDER BY id) FROM sessions t),
    'persons', (SELECT jsonb_agg(t ORDER BY id) FROM persons t)
  ) AS state WHERE EXISTS (SELECT 1 FROM privacy_cases WHERE id=$1)`,
    [f.privacyCase.id],
  );
  assert(result.rows[0] !== undefined);
  return result.rows[0].state;
}

export function expectedNativeFingerprint(f: SubjectReviewFixture) {
  const body = canonicalScopeJson({
    domain: "privacy-native-subject-projection:v1",
    adapterVersion: 1,
    store: f.subject.kind === "contact" ? "persons" : "users",
    recordType: f.subject.kind === "contact" ? "person" : "user",
    recordId: f.subject.referenceId,
    values: expectedNativeValues(f),
  });
  // Existing keyed primitive returns base64url; the draft contract requires 64 lower-case hex.
  return Buffer.from(
    fingerprintPrivacy(body, {
      caseId: f.privacyCase.id,
      purpose: "decision",
    }),
    "base64url",
  ).toString("hex");
}
