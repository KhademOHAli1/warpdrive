import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { privacyCases, privacyCaseVerifications } from "@/db/schema";
import type { TestDb } from "@/test/db";
import { authorityFixture } from "./authority.test-helpers";
import { encryptPrivacy } from "./crypto";

export async function identityFixture(h: TestDb) {
  const f = await authorityFixture(h, ["case.review", "case.disclose"]);
  await h.db
    .delete(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, f.privacyCase.id));
  await h.db
    .update(privacyCases)
    .set({
      status: "verification_needed",
      verifiedAt: null,
      metadataEnc: encryptPrivacy(
        JSON.stringify({
          intakeKey: randomUUID(),
          kind: "access",
          locale: "fa",
          subject: { kind: "user", referenceId: f.user.id },
          recipient: { channel: "in_app", userId: f.user.id },
          summary: "Synthetic identity request",
        }),
        { caseId: f.privacyCase.id, purpose: "intake" },
      ),
    })
    .where(eq(privacyCases.id, f.privacyCase.id));
  return f;
}

export const operatorVerification = (caseId: string, expectedVersion = 1) => ({
  caseId,
  expectedVersion,
  commandId: randomUUID(),
  subject: { kind: "external", description: "PRIVATE-IDENTITY-SUBJECT" },
  recipient: { channel: "email", address: "private-recipient@example.test" },
  evidence: {
    trustedChannel: "previously_verified_email",
    evidenceRef: "PRIVATE-EXTERNAL-CHECK-REFERENCE",
    observedAt: new Date().toISOString(),
    confirmedSubject: true,
    confirmedRecipient: true,
  },
});
