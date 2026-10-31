import { z } from "zod";
import {
  MAX_DISCLOSURE_CATEGORIES,
  MAX_DISCLOSURE_FILES,
  MAX_DISCLOSURE_REFERENCES,
} from "./disclosureLimits";

const opaqueId = z.uuid();
const positive = z.number().int().positive();
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const categoryId = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/u);
const sourceStore = z.string().regex(/^[A-Za-z][A-Za-z0-9]*:[A-Za-z0-9_.-]{1,120}$/u);
export const disclosureBindingSchema = z
  .object({
    caseId: opaqueId,
    subjectId: opaqueId,
    scopeId: opaqueId,
    scopeVersion: positive,
    scopeHash: digest,
    policyVersion: positive,
    policyGeneration: positive,
    recipientVersion: positive,
    verificationVersion: positive,
  })
  .strict();

export const disclosureFileSchema = z
  .object({
    path: z.string().max(512),
    sha256: digest,
    bytes: z.number().int().nonnegative(),
    recordIds: z.array(opaqueId).max(MAX_DISCLOSURE_REFERENCES),
    representation: z.enum(["json", "csv", "attachment", "original_eml", "reconstructed_eml"]),
  })
  .strict();
const common = { reviewed: z.boolean(), reviewId: opaqueId };
const includeDecision = z
  .object({
    ...common,
    disposition: z.literal("include"),
    thirdParty: z.enum(["none", "redacted", "pending"]),
    portabilityEligible: z.boolean(),
    transformations: z
      .array(z.enum(["third_party_redaction", "spreadsheet_escaping", "reconstructed_mime"]))
      .max(3),
    email: z
      .object({
        original: z.enum(["available", "unavailable", "not_applicable"]),
        exported: z.enum(["original", "reconstructed", "none", "not_applicable"]),
      })
      .strict(),
  })
  .strict();
const excludeDecision = z
  .object({
    ...common,
    disposition: z.literal("exclude"),
    reason: z.enum([
      "security_material",
      "third_party_rights",
      "not_portable",
      "policy_exception",
      "not_subject_data",
    ]),
  })
  .strict();
const unsupportedDecision = z
  .object({
    ...common,
    disposition: z.literal("unsupported"),
    reason: z.literal("adapter_unavailable"),
    task: z.string().regex(/^DPL-(?:0[1-9]|[12][0-9]|3[0-6])$/u),
  })
  .strict();
export const disclosureDecisionSchema = z.discriminatedUnion("disposition", [
  includeDecision,
  excludeDecision,
  unsupportedDecision,
]);
const category = { id: categoryId, sourceStore };
export const disclosureCategorySchema = z.discriminatedUnion("disposition", [
  includeDecision.extend({
    ...category,
    files: z.array(disclosureFileSchema).max(MAX_DISCLOSURE_FILES),
  }),
  excludeDecision.extend(category),
  unsupportedDecision.extend(category),
]);
export const disclosureContextSchema = z
  .object({
    binding: disclosureBindingSchema,
    mode: z.enum(["access", "portability"]),
    approvalId: opaqueId,
    scopeApproved: z.boolean(),
    subjectVerified: z.boolean(),
    policy: z
      .object({
        activated: z.boolean(),
        disclosureEnabled: z.boolean(),
        portabilityDecision: z.enum(["eligible", "ineligible", "unreviewed"]),
        portabilityReviewId: opaqueId.nullable(),
      })
      .strict(),
    expectedCategories: z
      .array(
        z
          .object({
            ...category,
            capability: z.enum(["supported", "unsupported", "review_required"]),
            recordIds: z
              .array(opaqueId)
              .max(MAX_DISCLOSURE_REFERENCES)
              .refine((ids) => new Set(ids).size === ids.length),
            decision: disclosureDecisionSchema,
          })
          .strict(),
      )
      .max(MAX_DISCLOSURE_CATEGORIES),
  })
  .strict();
export const disclosureManifestInputSchema = z
  .object({
    formatVersion: z.literal(1),
    binding: disclosureBindingSchema,
    mode: z.enum(["access", "portability"]),
    locale: z.enum(["fa", "de", "en"]),
    generatedAt: z.iso.datetime({ offset: true }),
    categories: z.array(disclosureCategorySchema).max(MAX_DISCLOSURE_CATEGORIES),
  })
  .strict();

export type DisclosureContext = z.infer<typeof disclosureContextSchema>;
export type DisclosureManifestInput = z.infer<typeof disclosureManifestInputSchema>;
export type DisclosureCategory = z.infer<typeof disclosureCategorySchema>;
type File = z.infer<typeof disclosureFileSchema>;
type IncludedCategory = Extract<DisclosureCategory, { disposition: "include" }>;
export type DisclosureManifestCategory =
  | (Omit<IncludedCategory, "files"> & {
      files: (File & { recordCount: number })[];
      recordCount: number;
    })
  | (Exclude<DisclosureCategory, IncludedCategory> & { recordCount: number });
export interface DisclosureManifest {
  formatVersion: 1;
  encoding: "utf-8";
  binding: DisclosureContext["binding"];
  approvalId: string;
  mode: DisclosureManifestInput["mode"];
  locale: DisclosureManifestInput["locale"];
  generatedAt: string;
  state: "reviewed" | "blocked";
  categories: DisclosureManifestCategory[];
  blockers: { categoryId: string; code: "adapter_unavailable"; task: string }[];
}
