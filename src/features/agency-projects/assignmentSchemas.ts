import { z } from "zod";
import type { AssignmentCommand, AssignmentSnapshot } from "./assignmentLifecycle";
import { canonicalUuidSchema, reasonSchema, referenceSchema, revisionSchema } from "./valueSchemas";

const acceptanceSchema = z.strictObject({
  source: z.literal("staff-recorded"),
  recordedByUserId: canonicalUuidSchema,
  freelancerContactId: canonicalUuidSchema,
  evidenceReference: referenceSchema,
});
const approvalSchema = z.strictObject({
  kind: z.literal("internal"),
  recordedByUserId: canonicalUuidSchema,
  versionReference: referenceSchema,
});
const storedBase = {
  revision: revisionSchema,
  freelancerContactId: canonicalUuidSchema,
  internalOwnerUserId: canonicalUuidSchema,
};
const unapproved = { ...storedBase, acceptance: acceptanceSchema, approval: z.null() };

export const assignmentSnapshotSchema = z
  .union([
    z.strictObject({
      ...storedBase,
      state: z.literal("awaiting-acceptance"),
      versionReference: z.null(),
      acceptance: z.null(),
      approval: z.null(),
    }),
    z.strictObject({
      ...unapproved,
      state: z.literal("working"),
      versionReference: referenceSchema.nullable(),
    }),
    z.strictObject({
      ...unapproved,
      state: z.enum(["submitted", "internal-review", "changes-requested"]),
      versionReference: referenceSchema,
    }),
    z.strictObject({
      ...storedBase,
      state: z.literal("approved"),
      versionReference: referenceSchema,
      acceptance: acceptanceSchema,
      approval: approvalSchema,
    }),
    z.strictObject({
      ...storedBase,
      state: z.literal("canceled"),
      versionReference: z.null(),
      acceptance: z.null(),
      approval: z.null(),
    }),
    z.strictObject({
      ...unapproved,
      state: z.literal("canceled"),
      versionReference: referenceSchema.nullable(),
    }),
  ])
  .refine(
    (record) =>
      record.acceptance === null ||
      record.acceptance.freelancerContactId === record.freelancerContactId,
    {
      path: ["acceptance", "freelancerContactId"],
      message: "Acceptance must identify the selected contact",
    },
  )
  .refine(
    (record) =>
      record.approval === null || record.approval.versionReference === record.versionReference,
    {
      path: ["approval", "versionReference"],
      message: "Approval must identify the submitted version",
    },
  ) satisfies z.ZodType<AssignmentSnapshot>;

const expectedRevision = revisionSchema;
const recordAcceptance = z.strictObject({
  action: z.literal("record-acceptance"),
  expectedRevision,
  freelancerContactId: canonicalUuidSchema,
  evidenceReference: referenceSchema,
});
const submit = z.strictObject({
  action: z.literal("submit"),
  expectedRevision,
  submittedVersionReference: referenceSchema,
});
const beginReview = z.strictObject({ action: z.literal("begin-review"), expectedRevision });
const requestChanges = z.strictObject({
  action: z.literal("request-changes"),
  expectedRevision,
  reason: reasonSchema.min(1),
});
const resumeWork = z.strictObject({ action: z.literal("resume-work"), expectedRevision });
const approve = z.strictObject({
  action: z.literal("approve"),
  expectedRevision,
  reviewedVersionReference: referenceSchema,
});
const cancel = z.strictObject({
  action: z.literal("cancel"),
  expectedRevision,
  reason: reasonSchema.min(1),
});

// Browser action payloads cannot choose the recording staff identity.
export const assignmentActionSchema = z.discriminatedUnion("action", [
  recordAcceptance,
  submit,
  beginReview,
  requestChanges,
  resumeWork,
  approve,
  cancel,
]);
const staff = { recordedByUserId: canonicalUuidSchema };
// Only server code may assemble this with its actual native actor after request policy passes.
export const assignmentCommandSchema = z.discriminatedUnion("action", [
  recordAcceptance.extend(staff),
  submit.extend(staff),
  beginReview.extend(staff),
  requestChanges.extend(staff),
  resumeWork.extend(staff),
  approve.extend(staff),
  cancel.extend(staff),
]) satisfies z.ZodType<AssignmentCommand>;
