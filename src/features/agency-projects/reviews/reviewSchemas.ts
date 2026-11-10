import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { exactInstantSchema } from "../instantSchema";
import {
  canonicalUuidSchema,
  reasonSchema,
  referenceSchema,
  revisionSchema,
} from "../valueSchemas";
import type { ReviewAction, ReviewCommand } from "./reviewTypes";

const target = {
  projectId: canonicalUuidSchema,
  deliverableId: canonicalUuidSchema,
  expectedRevision: revisionSchema,
};
const evidence = {
  outcome: z.literal("approved"),
  reviewedVersionReference: referenceSchema,
  evidenceReference: referenceSchema,
  occurredAt: exactInstantSchema,
};
const internalReview = z.strictObject({
  ...target,
  ...evidence,
  action: z.literal("record-internal-review"),
  method: z.literal("internal-review"),
});
const clientApproval = z.strictObject({
  ...target,
  ...evidence,
  action: z.literal("record-client-approval"),
  clientContactId: canonicalUuidSchema,
  method: z.enum(["email", "phone", "meeting", "message"]),
});
const changeVersion = z.strictObject({
  ...target,
  action: z.literal("change-version"),
  versionReference: referenceSchema,
  reason: reasonSchema.min(1),
});
const reopenReview = z.strictObject({
  ...target,
  action: z.literal("reopen-review"),
  reason: reasonSchema.min(1),
});

export const reviewActionSchema = z.discriminatedUnion("action", [
  internalReview,
  clientApproval,
  changeVersion,
  reopenReview,
]) satisfies z.ZodType<ReviewAction>;

const nativeRecorder = { recordedByUserId: canonicalUuidSchema, recordedAt: exactInstantSchema };

function occurrenceNotAfterRecording(command: ReviewCommand): boolean {
  if (command.action !== "record-internal-review" && command.action !== "record-client-approval") {
    return true;
  }
  try {
    return Temporal.Instant.compare(command.occurredAt, command.recordedAt) <= 0;
  } catch {
    return false;
  }
}

export const reviewCommandSchema = z
  .discriminatedUnion("action", [
    internalReview.extend(nativeRecorder),
    clientApproval.extend(nativeRecorder),
    changeVersion.extend(nativeRecorder),
    reopenReview.extend(nativeRecorder),
  ])
  .refine(occurrenceNotAfterRecording, {
    path: ["occurredAt"],
    message: "Occurrence must not follow server recording time",
  }) satisfies z.ZodType<ReviewCommand>;
