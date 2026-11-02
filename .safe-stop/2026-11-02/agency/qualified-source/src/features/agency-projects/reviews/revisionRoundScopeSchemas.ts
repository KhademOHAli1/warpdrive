import { z } from "zod";
import { plainTextSchema } from "../communication/communicationValueSchemas";
import { exactInstantSchema } from "../instantSchema";
import { canonicalUuidSchema, referenceSchema, revisionSchema } from "../valueSchemas";

const targetShape = {
  projectId: canonicalUuidSchema,
  deliverableId: canonicalUuidSchema,
};
const positiveOrdinalSchema = revisionSchema.min(1);

export const revisionRoundDeclarationSchema = z.strictObject({
  ...targetShape,
  roundNumber: positiveOrdinalSchema,
  expectedAllowanceVersion: positiveOrdinalSchema,
});

const allowanceHeader = {
  ...targetShape,
  version: positiveOrdinalSchema,
  provenance: z.literal("staff-recorded"),
  recordedByUserId: canonicalUuidSchema,
  recordedAt: exactInstantSchema,
};

export const recordedRoundAllowanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...allowanceHeader, kind: z.literal("unknown") }),
  z.strictObject({
    ...allowanceHeader,
    kind: z.literal("agreed"),
    includedRounds: revisionSchema,
    agreementSource: plainTextSchema(160, false),
    evidenceReference: referenceSchema,
  }),
]);

export type RevisionRoundDeclaration = z.infer<typeof revisionRoundDeclarationSchema>;
export type RecordedRoundAllowance = z.infer<typeof recordedRoundAllowanceSchema>;
