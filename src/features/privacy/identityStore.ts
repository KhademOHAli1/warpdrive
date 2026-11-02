import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { privacyCases, privacyCaseVerifications } from "@/db/schema";
import { err, ok } from "@/types/result";
import type { PrivacyActor } from "./authoritySession";
import { privacyCaseSummary } from "./casePersistence";
import { privacyIntakeSchema } from "./caseSchemas";
import { encryptPrivacy, fingerprintPrivacy } from "./crypto";
import {
  decodeIdentity,
  type IdentityCase,
  identityAttentionStatus,
  readIdentityIntake,
  recordIdentityEvent,
} from "./identityPersistence";
import type { ReviewedRecipient, ReviewedSubject, StoredIdentityEvidence } from "./identitySchemas";

export const identityRecipientDigest = (recipient: ReviewedRecipient, caseId: string) =>
  fingerprintPrivacy(JSON.stringify(recipient), { caseId, purpose: "identity" });

export async function storeIdentityProof(
  db: Db,
  actor: PrivacyActor,
  row: IdentityCase,
  commandId: string,
  digest: string,
  subject: ReviewedSubject,
  recipient: ReviewedRecipient,
  evidence: StoredIdentityEvidence,
  action: string,
  signal: AbortSignal,
) {
  const intake = readIdentityIntake(row);
  if (!intake.ok) return intake;
  const [existing] = await db
    .select()
    .from(privacyCaseVerifications)
    .where(eq(privacyCaseVerifications.caseId, row.id));
  signal.throwIfAborted();
  const priorSubject =
    existing?.subjectEnc === null || existing?.subjectEnc === undefined
      ? ok(intake.value.subject)
      : decodeIdentity(existing.subjectEnc, privacyIntakeSchema.shape.subject, row.id);
  const priorRecipient =
    existing === undefined
      ? ok(intake.value.recipient)
      : decodeIdentity(existing.recipientEnc, privacyIntakeSchema.shape.recipient, row.id);
  if (!priorSubject.ok || !priorRecipient.ok) return err("evidence_unavailable" as const);
  const scopeVersion =
    row.scopeVersion + (JSON.stringify(subject) === JSON.stringify(priorSubject.value) ? 0 : 1);
  const recipientVersion =
    row.recipientVersion +
    (JSON.stringify(recipient) === JSON.stringify(priorRecipient.value) ? 0 : 1);
  const verificationVersion = row.verificationVersion + 1;
  const verifiedAt = new Date();
  const recipientDigest = identityRecipientDigest(recipient, row.id);
  const proof = {
    caseId: row.id,
    subjectKind: subject.kind,
    subjectReferenceId: subject.kind === "external" ? null : subject.referenceId,
    subjectEnc: encryptPrivacy(JSON.stringify(subject), { caseId: row.id, purpose: "identity" }),
    recipientEnc: encryptPrivacy(JSON.stringify(recipient), {
      caseId: row.id,
      purpose: "identity",
    }),
    recipientDigest,
    evidenceEnc: encryptPrivacy(JSON.stringify(evidence), { caseId: row.id, purpose: "identity" }),
    method: evidence.method,
    verifiedBy: actor.userId,
    verifiedAt,
    scopeVersion,
    recipientVersion,
    verificationVersion,
    revokedAt: null,
  };
  await db
    .insert(privacyCaseVerifications)
    .values(proof)
    .onConflictDoUpdate({ target: privacyCaseVerifications.caseId, set: proof });
  const [updated] = await db
    .update(privacyCases)
    .set({
      scopeVersion,
      recipientVersion,
      verificationVersion,
      verifiedAt,
      version: row.version + 1,
      status: identityAttentionStatus(row),
      updatedAt: verifiedAt,
    })
    .where(eq(privacyCases.id, row.id))
    .returning();
  signal.throwIfAborted();
  if (updated === undefined) return err("storage_unavailable" as const);
  await recordIdentityEvent(
    db,
    actor,
    row,
    updated,
    commandId,
    digest,
    action,
    {
      method: evidence.method,
      evidence,
      scopeVersion,
      recipientVersion,
      verificationVersion,
      recipientDigest,
      subjectDigest: fingerprintPrivacy(JSON.stringify(subject), {
        caseId: row.id,
        purpose: "identity",
      }),
    },
    signal,
  );
  return ok(privacyCaseSummary(updated));
}
