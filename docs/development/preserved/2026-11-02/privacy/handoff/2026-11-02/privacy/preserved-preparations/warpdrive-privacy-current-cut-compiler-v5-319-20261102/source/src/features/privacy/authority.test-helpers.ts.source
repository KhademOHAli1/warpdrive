import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  authUsers,
  privacyAuthority,
  privacyCaseMembers,
  privacyCases,
  privacyCaseVerifications,
  sessions,
  users,
} from "@/db/schema";
import type { TestDb } from "@/test/db";
import type { PrivacyCapability } from "./capabilities";
import { encryptPrivacy, fingerprintPrivacy } from "./crypto";

export const authoritySignal = () => AbortSignal.timeout(10_000);

export async function authorityFixture(
  h: TestDb,
  capabilities: PrivacyCapability[] = ["case.disclose"],
) {
  const email = `privacy-${randomUUID()}@example.test`;
  const [user] = await h.db.insert(users).values({ email, name: "Synthetic reviewer" }).returning();
  assert(user !== undefined, "missing synthetic user");
  await h.db.insert(authUsers).values({ id: user.id, email, name: user.name, emailVerified: true });
  const [session] = await h.db
    .insert(sessions)
    .values({
      userId: user.id,
      tokenHash: createHash("sha256").update(randomUUID()).digest("base64url"),
      authMethod: "password",
      assurance: "mfa",
      freshAuthenticatedAt: new Date(),
      mfaVerifiedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  assert(session !== undefined, "missing synthetic session");
  const [privacyCase] = await h.db
    .insert(privacyCases)
    .values({
      kind: "access",
      status: "under_review",
      verifiedAt: new Date(),
      createdBy: user.id,
      intakeKey: randomUUID(),
      intakeDigest: randomUUID(),
      metadataEnc: Buffer.alloc(0),
    })
    .returning();
  assert(privacyCase !== undefined, "missing synthetic case");
  const subject = { kind: "user", referenceId: user.id };
  const recipient = { channel: "in_app", userId: user.id };
  await h.db
    .update(privacyCases)
    .set({
      metadataEnc: encryptPrivacy(
        JSON.stringify({
          intakeKey: privacyCase.intakeKey,
          kind: "access",
          locale: "en",
          subject,
          recipient,
          summary: "Synthetic privacy fixture",
        }),
        { caseId: privacyCase.id, purpose: "intake" },
      ),
    })
    .where(eq(privacyCases.id, privacyCase.id));
  await h.db.insert(privacyCaseVerifications).values({
    caseId: privacyCase.id,
    subjectKind: "user",
    subjectReferenceId: user.id,
    subjectEnc: encryptPrivacy(JSON.stringify(subject), {
      caseId: privacyCase.id,
      purpose: "identity",
    }),
    recipientEnc: encryptPrivacy(JSON.stringify(recipient), {
      caseId: privacyCase.id,
      purpose: "identity",
    }),
    recipientDigest: fingerprintPrivacy(JSON.stringify(recipient), {
      caseId: privacyCase.id,
      purpose: "identity",
    }),
    evidenceEnc: encryptPrivacy(
      JSON.stringify({
        method: "operator_review",
        confirmation: {
          trustedChannel: "organizational_record",
          evidenceRef: "synthetic-operator-review",
          observedAt: new Date().toISOString(),
          confirmedSubject: true,
          confirmedRecipient: true,
        },
      }),
      { caseId: privacyCase.id, purpose: "identity" },
    ),
    method: "operator_review",
    verifiedBy: user.id,
    verifiedAt: privacyCase.verifiedAt,
    scopeVersion: 1,
    recipientVersion: 1,
    verificationVersion: 1,
  });
  await h.db.insert(privacyAuthority).values({ userId: user.id, capabilities });
  await h.db
    .insert(privacyCaseMembers)
    .values({ caseId: privacyCase.id, userId: user.id, capabilities });
  return { user, session, privacyCase, actor: { userId: user.id, sessionId: session.id } };
}
