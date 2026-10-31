import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { type privacyCases, privacyCaseVerifications } from "@/db/schema";
import { privacyIntakeSchema } from "./caseSchemas";
import { decodeIdentity } from "./identityPersistence";
import { storedIdentityEvidenceSchema } from "./identitySchemas";
import { identityRecipientDigest } from "./identityStore";

export async function currentCaseIdentityBinding(
  db: Db,
  privacyCase: typeof privacyCases.$inferSelect,
  signal: AbortSignal,
): Promise<boolean> {
  if (privacyCase.verifiedAt === null) return false;
  const [proof] = await db
    .select()
    .from(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, privacyCase.id));
  signal.throwIfAborted();
  const current =
    proof !== undefined &&
    proof.revokedAt === null &&
    proof.verifiedAt !== null &&
    proof.verifiedAt.getTime() === privacyCase.verifiedAt.getTime() &&
    proof.verifiedBy !== null &&
    proof.subjectEnc !== null &&
    proof.evidenceEnc !== null &&
    proof.method !== null &&
    proof.scopeVersion === privacyCase.scopeVersion &&
    proof.recipientVersion === privacyCase.recipientVersion &&
    proof.verificationVersion === privacyCase.verificationVersion;
  if (!current || proof.subjectEnc === null || proof.evidenceEnc === null) return false;
  const subject = decodeIdentity(
    proof.subjectEnc,
    privacyIntakeSchema.shape.subject,
    privacyCase.id,
  );
  const recipient = decodeIdentity(
    proof.recipientEnc,
    privacyIntakeSchema.shape.recipient,
    privacyCase.id,
  );
  const evidence = decodeIdentity(proof.evidenceEnc, storedIdentityEvidenceSchema, privacyCase.id);
  if (!subject.ok || !recipient.ok || !evidence.ok || evidence.value.method !== proof.method)
    return false;
  if (
    proof.subjectKind !== subject.value.kind ||
    proof.subjectReferenceId !==
      (subject.value.kind === "external" ? null : subject.value.referenceId)
  )
    return false;
  if (proof.recipientDigest !== identityRecipientDigest(recipient.value, privacyCase.id))
    return false;
  return (
    evidence.value.method === "operator_review" ||
    (subject.value.kind === "user" &&
      subject.value.referenceId === evidence.value.userId &&
      recipient.value.channel === "in_app" &&
      recipient.value.userId === evidence.value.userId &&
      proof.verifiedBy === evidence.value.userId)
  );
}
