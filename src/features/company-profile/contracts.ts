import { z } from "zod";
import { companyDetailsSchema } from "./fields";
import {
  legalEntityDataSchema,
  legalEntitySchema,
  payerPreferencesSchema,
  provenanceSchema,
} from "./legalContracts";

export * from "./fields";
export * from "./legalContracts";

export const companyBrandingInputSchema = z.strictObject({
  iconAssetId: z.uuid().nullable().default(null),
  logoAssetId: z.uuid().nullable().default(null),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((v) => v.toLowerCase())
    .nullable()
    .default(null),
  fit: z.enum(["contain", "cover"]).default("contain"),
});
export const companyBrandingSchema = companyBrandingInputSchema.extend({
  iconUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
  foregroundColor: z.enum(["#000000", "#ffffff"]),
});
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const envelope = { requestId: z.uuid(), expectedRevision: revision };
export const companyCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("cancel_operation"),
    requestId: z.uuid(),
    operationId: z.uuid(),
    operationAction: z.enum([
      "save_details",
      "save_branding",
      "save_legal_entity",
      "archive_legal_entity",
      "save_payer_preferences",
      "upload_asset",
    ]),
  }),
  z.strictObject({ action: z.literal("save_details"), ...envelope, details: companyDetailsSchema }),
  z.strictObject({
    action: z.literal("save_branding"),
    ...envelope,
    branding: companyBrandingInputSchema,
  }),
  z.strictObject({
    action: z.literal("save_legal_entity"),
    ...envelope,
    id: z.uuid().nullable(),
    data: legalEntityDataSchema,
  }),
  z.strictObject({ action: z.literal("archive_legal_entity"), ...envelope, id: z.uuid() }),
  z.strictObject({
    action: z.literal("save_payer_preferences"),
    ...envelope,
    preferences: payerPreferencesSchema,
  }),
]);
export const companyCancellationSchema = z.strictObject({
  operationId: z.uuid(),
  status: z.enum(["canceled", "completed"]),
  result: z.unknown().optional(),
});
export const companyOverviewSchema = z.strictObject({
  workspaceScope: z.string(),
  details: companyDetailsSchema,
  detailsRevision: revision,
  branding: companyBrandingSchema,
  brandingRevision: revision,
  baseCurrency: z.string(),
  legalEntities: z.array(legalEntitySchema),
  payerPreferences: payerPreferencesSchema.nullable(),
  payerRevision: revision.nullable(),
  capabilities: z.strictObject({ manageProfile: z.boolean(), manageLegal: z.boolean() }),
  confirmedAt: z.string().nullable(),
  provenance: provenanceSchema.nullable(),
});
export const cropSchema = z
  .strictObject({
    left: z.number().min(0).max(1),
    top: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((v) => v.left + v.width <= 1 && v.top + v.height <= 1);
export const assetUploadResultSchema = z.strictObject({
  assetId: z.uuid(),
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  contentType: z.literal("image/png"),
});
export type CompanyBrandingInput = z.infer<typeof companyBrandingInputSchema>;
export type CompanyBranding = z.infer<typeof companyBrandingSchema>;
export type CompanyCommand = z.infer<typeof companyCommandSchema>;
export type CompanyOverview = z.infer<typeof companyOverviewSchema>;
export type AssetUploadResult = z.infer<typeof assetUploadResultSchema>;
export type CompanyCrop = z.infer<typeof cropSchema>;
export type CompanyErrorCode =
  | "unauthorized"
  | "fresh_auth_required"
  | "forbidden"
  | "invalid_input"
  | "conflict"
  | "not_found"
  | "storage_unavailable"
  | "asset_invalid"
  | "provider_unavailable"
  | "replay_conflict"
  | "write_failed"
  | "rate_limited";
export type CompanyFailure = {
  code: CompanyErrorCode;
  id?: string;
  fields?: Record<string, string>;
};
export type CompanyResponse<T> = { ok: true; data: T } | { ok: false; error: CompanyFailure };
