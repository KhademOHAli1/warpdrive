import { z } from "zod";
import { privacyIntakeSchema } from "./caseSchemas";

export const identityCommandSchema = z.strictObject({
  caseId: z.uuid(),
  expectedVersion: z.number().int().positive(),
  commandId: z.uuid(),
});
export const identityEvidenceSchema = z.strictObject({
  trustedChannel: z.enum([
    "previously_verified_email",
    "previously_verified_phone",
    "in_person",
    "organizational_record",
  ]),
  evidenceRef: z.string().trim().min(1).max(240),
  observedAt: z.iso.datetime({ offset: true }),
  confirmedSubject: z.literal(true),
  confirmedRecipient: z.literal(true),
});
export const identityVerificationSchema = identityCommandSchema.extend({
  subject: privacyIntakeSchema.shape.subject,
  recipient: privacyIntakeSchema.shape.recipient,
  evidence: identityEvidenceSchema,
});
export const identityRecipientSchema = identityCommandSchema.extend({
  recipient: privacyIntakeSchema.shape.recipient,
  reason: z.string().trim().min(1).max(1000),
});
export type ReviewedSubject = z.infer<typeof privacyIntakeSchema.shape.subject>;
export type ReviewedRecipient = z.infer<typeof privacyIntakeSchema.shape.recipient>;

export const storedIdentityEvidenceSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("operator_review"), confirmation: identityEvidenceSchema }),
  z.strictObject({
    method: z.literal("authenticated_self"),
    userId: z.uuid(),
    sessionId: z.uuid(),
    observedAt: z.iso.datetime({ offset: true }),
  }),
]);
export type StoredIdentityEvidence = z.infer<typeof storedIdentityEvidenceSchema>;
