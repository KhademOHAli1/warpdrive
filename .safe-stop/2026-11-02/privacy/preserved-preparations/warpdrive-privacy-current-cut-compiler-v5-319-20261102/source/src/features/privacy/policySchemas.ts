import { z } from "zod";

const fact = z.string().trim().min(1).max(1000).nullable();
const recipientKind = z.enum([
  "smtp",
  "analytics",
  "enrichment",
  "storage",
  "backup",
  "provider",
  "other",
]);
export const privacyPolicyProfileSchema = z.object({
  controller: z.object({
    identity: fact,
    role: z.enum(["controller", "processor"]).nullable(),
    privacyContact: fact,
    controllerContact: fact,
  }),
  jurisdictions: z.array(z.string().trim().min(1).max(200)).max(20),
  purposes: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        description: fact,
        ground: fact,
        retentionProfile: fact,
      }),
    )
    .max(100),
  recipients: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        kind: recipientKind,
        enabled: z.boolean().nullable(),
        identity: fact,
        role: z.enum(["controller", "processor", "subprocessor"]).nullable(),
        locations: z.array(z.string().trim().min(1).max(200)).max(20).nullable(),
        transferReview: fact,
        contractReference: fact,
      }),
    )
    .max(100),
  retention: z.object({
    activeCrm: z.object({
      enabled: z.boolean(),
      days: z.number().int().positive().nullable(),
      anchor: fact,
      reviewReference: fact,
    }),
    caseMetadataDays: z.number().int().positive().nullable(),
    exportHours: z.number().int().min(1).max(24),
    grantMinutes: z.number().int().min(1).max(5),
    approvalHours: z.number().int().min(1).max(24),
    authBodyDays: z.literal(7),
    authMetadataDays: z.literal(180),
  }),
  rights: z.object({ disclosureEnabled: z.boolean(), eligibilityReview: fact }),
  deadline: z.object({
    jurisdiction: fact,
    timeZone: fact,
    responseMonths: z.number().int().min(1).max(12).nullable(),
    maxExtensionMonths: z.number().int().min(0).max(12).nullable(),
    disambiguation: z.enum(["earlier", "later", "reject"]),
  }),
});
export type PrivacyPolicyProfile = z.infer<typeof privacyPolicyProfileSchema>;

export const savePrivacyPolicyDraftSchema = z
  .object({
    id: z.uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    profile: privacyPolicyProfileSchema,
  })
  .refine((input) => (input.id === undefined) === (input.expectedRevision === undefined));
export const activatePrivacyPolicySchema = z.object({
  draftId: z.uuid(),
  expectedDraftRevision: z.number().int().positive(),
  expectedActiveVersion: z.number().int().positive().nullable(),
  reviewReference: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(2000),
});

export function privacyPolicyComplete(profile: PrivacyPolicyProfile): boolean {
  const controller = profile.controller;
  if (
    Object.values(controller).some((value) => value === null) ||
    profile.jurisdictions.length === 0
  )
    return false;
  if (
    profile.purposes.length === 0 ||
    profile.purposes.some((purpose) => Object.values(purpose).some((value) => value === null))
  )
    return false;
  if (new Set(profile.purposes.map((purpose) => purpose.id)).size !== profile.purposes.length)
    return false;
  if (
    new Set(profile.recipients.map((recipient) => recipient.id)).size !== profile.recipients.length
  )
    return false;
  for (const kind of ["smtp", "analytics", "enrichment", "storage", "backup"])
    if (!profile.recipients.some((recipient) => recipient.kind === kind)) return false;
  if (
    profile.recipients.some(
      (recipient) =>
        recipient.enabled === null ||
        (recipient.enabled &&
          (recipient.identity === null ||
            recipient.role === null ||
            recipient.locations === null ||
            recipient.locations.length === 0 ||
            recipient.transferReview === null ||
            recipient.contractReference === null)),
    )
  )
    return false;
  const crm = profile.retention.activeCrm;
  if (crm.enabled && (crm.days === null || crm.anchor === null || crm.reviewReference === null))
    return false;
  if (profile.rights.disclosureEnabled && profile.rights.eligibilityReview === null) return false;
  return true;
}
