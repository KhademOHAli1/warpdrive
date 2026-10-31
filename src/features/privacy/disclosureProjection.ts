import type { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { disclosureFieldSchema } from "./disclosureFields";
import {
  disclosureRecordReviewSchema,
  disclosureSourceSchema,
} from "./disclosureProjectionSchemas";
import { disclosureExclusionAllowed } from "./disclosureValidation";

type ProjectionFailure =
  | "invalid_record_review"
  | "invalid_record"
  | "scope_unapproved"
  | "record_mismatch"
  | "field_duplicate"
  | "review_required"
  | "field_forbidden"
  | "portability_ineligible"
  | "third_party_review_required"
  | "redaction_required"
  | "field_invalid";
interface DisclosureProjection {
  recordType: "person" | "user" | "email_message";
  recordId: string;
  data: Record<string, unknown>;
  fields: { name: string; action: "include" | "redact" | "exclude"; reason?: string }[];
}

type Review = z.infer<typeof disclosureRecordReviewSchema>;
type Field = Review["fields"][number];
type ProjectedField = { metadata: DisclosureProjection["fields"][number] } & (
  | { included: true; value: unknown }
  | { included: false }
);

function projectField(
  record: Record<string, unknown>,
  review: Review,
  field: Field,
): Result<ProjectedField, ProjectionFailure> {
  if (!field.reviewed) return err("review_required");
  if (field.action !== "include" && !disclosureExclusionAllowed(review.mode, field.reason))
    return err("review_required");
  if (field.action === "exclude") {
    return ok({
      included: false,
      metadata: { name: field.name, action: field.action, reason: field.reason },
    });
  }
  const schema = disclosureFieldSchema(review.recordType, field.name);
  if (schema === undefined) return err("field_forbidden");
  if (review.mode === "portability" && !field.portabilityEligible)
    return err("portability_ineligible");
  if (field.action === "include" && field.thirdParty !== "none")
    return err("third_party_review_required");
  const original = schema.safeParse(record[field.name]);
  if (!original.success) return err("field_invalid");
  const value = field.action === "include" ? original : schema.safeParse(field.replacement);
  if (!value.success) return err("field_invalid");
  if (field.action === "redact" && JSON.stringify(value.data) === JSON.stringify(original.data))
    return err("redaction_required");
  return ok({
    included: true,
    value: value.data,
    metadata: {
      name: field.name,
      action: field.action,
      ...(field.action === "redact" ? { reason: field.reason } : {}),
    },
  });
}

// The review is supplied by the server's approved scope, never by an untrusted export request.
export function projectDisclosureRecord(
  source: unknown,
  trustedReview: unknown,
): Result<DisclosureProjection, ProjectionFailure> {
  const review = disclosureRecordReviewSchema.safeParse(trustedReview);
  if (!review.success) return err("invalid_record_review");
  const record = disclosureSourceSchema.safeParse(source);
  if (!record.success) return err("invalid_record");
  const selected = review.data;
  if (!selected.approved) return err("scope_unapproved");
  if (record.data.id !== selected.recordId) return err("record_mismatch");
  if (new Set(selected.fields.map((field) => field.name)).size !== selected.fields.length)
    return err("field_duplicate");
  const data: Record<string, unknown> = {};
  const fields: DisclosureProjection["fields"] = [];
  for (const field of selected.fields) {
    const projected = projectField(record.data, selected, field);
    if (!projected.ok) return projected;
    if (projected.value.included) data[field.name] = projected.value.value;
    fields.push(projected.value.metadata);
  }
  return ok({ recordType: selected.recordType, recordId: selected.recordId, data, fields });
}
