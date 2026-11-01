import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { exactInstantSchema } from "../instantSchema";
import { canonicalUuidSchema, referenceSchema, revisionSchema } from "../valueSchemas";
import { communicationChannelSchema, plainTextSchema } from "./communicationValueSchemas";

export const manualDeclarationSchema = z.strictObject({
  channel: communicationChannelSchema,
  occurredAt: exactInstantSchema,
  note: plainTextSchema(2000, true),
  evidenceReference: referenceSchema.optional(),
});
const actionFields = {
  mutationIntentId: canonicalUuidSchema,
  projectId: canonicalUuidSchema,
  personId: canonicalUuidSchema,
  declaration: manualDeclarationSchema,
};
const record = z.strictObject({ ...actionFields, action: z.literal("record") });
const correct = z.strictObject({
  ...actionFields,
  action: z.literal("correct"),
  logId: canonicalUuidSchema,
  expectedRevision: revisionSchema,
  reason: plainTextSchema(1000, true),
});
export const manualActionSchema = z.discriminatedUnion("action", [record, correct]);
const nativeRecorder = { recordedByUserId: canonicalUuidSchema, recordedAt: exactInstantSchema };
const commandShape = z.discriminatedUnion("action", [
  record.extend({ ...nativeRecorder, logId: canonicalUuidSchema }),
  correct.extend(nativeRecorder),
]);
function orderedOccurrence(command: z.infer<typeof commandShape>): boolean {
  try {
    return Temporal.Instant.compare(command.declaration.occurredAt, command.recordedAt) <= 0;
  } catch {
    return false;
  }
}
export const manualCommandSchema = commandShape.refine(orderedOccurrence);

export const manualHeadSchema = z.strictObject({
  projectId: canonicalUuidSchema,
  logId: canonicalUuidSchema,
  personId: canonicalUuidSchema,
  provenance: z.literal("staff-recorded"),
  revision: revisionSchema.min(1),
  lastRecordedAt: exactInstantSchema,
  declaration: manualDeclarationSchema,
});
const receiptShape = z.strictObject({
  policyVersion: z.literal(1),
  provenance: z.literal("staff-recorded"),
  action: z.enum(["record", "correct"]),
  mutationIntentId: canonicalUuidSchema,
  projectId: canonicalUuidSchema,
  logId: canonicalUuidSchema,
  personId: canonicalUuidSchema,
  previousPersonId: canonicalUuidSchema.nullable(),
  ...nativeRecorder,
  previousRevision: revisionSchema,
  revision: revisionSchema.min(1),
  reason: plainTextSchema(1000, true).nullable(),
});
function coherentReceipt(receipt: z.infer<typeof receiptShape>): boolean {
  if (receipt.action === "record") {
    return (
      receipt.previousRevision === 0 &&
      receipt.revision === 1 &&
      receipt.previousPersonId === null &&
      receipt.reason === null
    );
  }
  return (
    receipt.previousRevision >= 1 &&
    receipt.revision === receipt.previousRevision + 1 &&
    receipt.previousPersonId !== null &&
    receipt.reason !== null
  );
}
export const manualReceiptSchema = receiptShape.refine(coherentReceipt);
const priorIntent = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("applied"),
    request: manualActionSchema,
    receipt: manualReceiptSchema,
  }),
  z.strictObject({
    state: z.literal("deleted"),
    key: z.strictObject({
      recordedByUserId: canonicalUuidSchema,
      action: z.enum(["record", "correct"]),
      mutationIntentId: canonicalUuidSchema,
    }),
  }),
]);
export const manualContextShapeSchema = z.strictObject({
  current: manualHeadSchema.nullable(),
  priorIntent: priorIntent.nullable(),
});
