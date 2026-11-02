import { z } from "zod";
import { DISCOVERY_COVERAGE } from "./discoveryCoverage";
import {
  SCOPE_DRAFT_CATEGORY_LIMIT,
  SCOPE_DRAFT_FIELD_LIMIT,
  SCOPE_DRAFT_RECORD_LIMIT,
} from "./scopeDraftLimits";
import { scopeDraftLocatorSchema, scopeDraftUuid } from "./scopeDraftLocators";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.number().int().positive();
const fieldName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u);
const store = z.enum(DISCOVERY_COVERAGE.map((entry) => entry.store));
const review = z.enum(["reviewed", "pending"]);
const reason = z.enum([
  "security_material",
  "third_party_rights",
  "not_portable",
  "policy_exception",
  "not_subject_data",
]);
const subject = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.enum(["contact", "user"]),
    subjectRef: scopeDraftUuid,
    referenceId: scopeDraftUuid,
  }),
  z.strictObject({ kind: z.literal("external"), subjectRef: scopeDraftUuid }),
]);
const binding = z.strictObject({
  caseId: scopeDraftUuid,
  subject,
  identityScopeVersion: version,
  disclosureScopeRef: scopeDraftUuid,
  disclosureRevision: version,
  recipientVersion: version,
  verificationVersion: version,
  policyVersion: version,
  policyGeneration: version,
  registryVersion: version,
  registryFingerprint: digest,
  catalogFingerprint: digest,
  sourceFingerprint: digest,
  mode: z.enum(["access", "portability"]),
});
const provenance = z.strictObject({
  relation: z.enum([
    "verified_subject",
    "direct_reference",
    "reverse_reference",
    "reviewed_alias",
    "ambiguous_identifier",
    "shared_reference",
    "historical_reference",
    "typed_custom_reference",
    "manual_review",
  ]),
  confidence: z.enum(["exact", "linked", "ambiguous"]),
  review,
  evidenceRef: scopeDraftUuid,
  sourceFingerprint: digest,
});
const record = {
  recordRef: scopeDraftUuid,
  locator: scopeDraftLocatorSchema,
  sourceFingerprint: digest,
  provenance: z.array(provenance).min(1).max(SCOPE_DRAFT_FIELD_LIMIT),
};
const commonDecision = { review, decisionRef: scopeDraftUuid };
const categoryDecision = z.discriminatedUnion("disposition", [
  z.strictObject({ ...commonDecision, disposition: z.literal("include") }),
  z.strictObject({ ...commonDecision, disposition: z.literal("exclude"), reason }),
  z.strictObject({
    ...commonDecision,
    disposition: z.literal("unsupported"),
    reason: z.literal("adapter_unavailable"),
  }),
]);
const fieldDecision = {
  ...commonDecision,
  field: fieldName,
  portability: z.enum(["eligible", "ineligible", "unreviewed"]),
  provenanceRef: scopeDraftUuid,
  thirdParty: z.enum(["none", "present", "redacted", "unreviewed"]),
};
const decision = z.discriminatedUnion("action", [
  z.strictObject({ ...fieldDecision, action: z.literal("include") }),
  z.strictObject({ ...fieldDecision, action: z.literal("exclude"), reason }),
  z.strictObject({
    ...fieldDecision,
    action: z.literal("redact"),
    reason,
    replacement: z.strictObject({
      replacementRef: scopeDraftUuid,
      valueKind: z.enum([
        "text",
        "number",
        "boolean",
        "null",
        "text_list",
        "contact_points",
        "instant",
      ]),
      sha256: digest,
    }),
  }),
]);
const category = { store, adapterVersion: version };
export const scopeDraftContextSchema = z.strictObject({
  binding,
  categories: z
    .array(
      z.strictObject({
        ...category,
        capability: z.enum(["supported", "review_required", "unsupported"]),
        enumeration: z.enum(["complete", "live_candidates", "unavailable"]),
        records: z
          .array(
            z.strictObject({
              ...record,
              fields: z.array(fieldName).min(1).max(SCOPE_DRAFT_FIELD_LIMIT),
            }),
          )
          .max(SCOPE_DRAFT_RECORD_LIMIT),
      }),
    )
    .max(SCOPE_DRAFT_CATEGORY_LIMIT),
});
export const scopeDraftInputSchema = z.strictObject({
  binding,
  categories: z
    .array(
      z.strictObject({
        ...category,
        decision: categoryDecision,
        records: z
          .array(
            z.strictObject({
              ...record,
              decisions: z.array(decision).min(1).max(SCOPE_DRAFT_FIELD_LIMIT),
            }),
          )
          .max(SCOPE_DRAFT_RECORD_LIMIT),
      }),
    )
    .max(SCOPE_DRAFT_CATEGORY_LIMIT),
});
export type ScopeDraftInput = z.infer<typeof scopeDraftInputSchema>;
export type ScopeDraftContext = z.infer<typeof scopeDraftContextSchema>;
