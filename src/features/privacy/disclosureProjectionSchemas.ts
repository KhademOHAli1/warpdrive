import { z } from "zod";

const MAX_REVIEWED_FIELDS = 32;
const common = {
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/u),
  reviewed: z.boolean(),
  reviewId: z.uuid(),
};
const reason = z.enum([
  "security_material",
  "third_party_rights",
  "not_portable",
  "policy_exception",
  "not_subject_data",
]);
const fieldReview = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("include"),
      thirdParty: z.enum(["none", "present", "unreviewed"]),
      portabilityEligible: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("redact"),
      portabilityEligible: z.boolean(),
      reason,
      replacement: z.unknown(),
    })
    .strict()
    .refine((field) => field.replacement !== undefined),
  z.object({ ...common, action: z.literal("exclude"), reason }).strict(),
]);
export const disclosureRecordReviewSchema = z
  .object({
    recordType: z.enum(["person", "user", "email_message"]),
    recordId: z.uuid(),
    mode: z.enum(["access", "portability"]),
    approved: z.boolean(),
    fields: z.array(fieldReview).min(1).max(MAX_REVIEWED_FIELDS),
  })
  .strict();
export const disclosureSourceSchema = z.object({ id: z.uuid() }).passthrough();
