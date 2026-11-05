import { z } from "zod";

export const workKindSchema = z.enum(["vehicle_repair", "design", "it_consulting", "custom"]);
export type WorkKind = z.infer<typeof workKindSchema>;
const key = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const name = z.string().trim().min(1).max(120);
const uuid = z.string().uuid();
export const localeSchema = z.enum(["en", "de", "fa"]);
export const workPreferencesSchema = z
  .object({
    workTypes: z
      .array(workKindSchema)
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    primaryWorkType: workKindSchema.nullable(),
    modules: z.array(z.enum(["sales", "contacts", "activities", "work"])).max(4),
    primaryGoal: z.string().trim().max(300),
    deliveryModels: z.array(z.string().trim().min(1).max(80)).max(12),
    customerTypes: z.array(z.string().trim().min(1).max(80)).max(12),
  })
  .strict()
  .refine((v) => v.primaryWorkType === null || v.workTypes.includes(v.primaryWorkType));
export type WorkPreferences = z.infer<typeof workPreferencesSchema>;
export const fieldDefinitionSchema = z
  .object({
    key,
    label: name,
    type: z.enum(["text", "long_text", "number", "date", "select", "boolean"]),
    options: z.array(z.string().trim().min(1).max(120)).max(50),
    required: z.boolean(),
  })
  .strict()
  .refine((v) =>
    v.type === "select"
      ? v.options.length > 0 && new Set(v.options).size === v.options.length
      : v.options.length === 0,
  );
export type WorkFieldDefinition = z.infer<typeof fieldDefinitionSchema>;
export const stageDraftSchema = z
  .object({ key, name, bucket: z.enum(["open", "complete", "canceled"]) })
  .strict();
export type StageDraft = z.infer<typeof stageDraftSchema>;
export type WorkStage = StageDraft & { id: string; order: number; isArchived: boolean };
export type WorkType = {
  id: string;
  key: string;
  name: string;
  kind: WorkKind;
  revision: number;
  fields: WorkFieldDefinition[];
  stages: WorkStage[];
  isArchived: boolean;
};
export type Preset = {
  id: Exclude<WorkKind, "custom">;
  version: number;
  name: string;
  description: string;
  sales: { name: string; stages: string[] };
  delivery: { name: string; stages: StageDraft[]; fields: WorkFieldDefinition[] };
  dealFields: { key: string; name: string; type: "text" | "numeric" | "date" }[];
  activityTypes: { key: string; name: string; icon: string }[];
};
export const selectionSchema = z
  .object({
    sales: z.boolean(),
    delivery: z.boolean(),
    dealFields: z.boolean(),
    activityTypes: z.boolean(),
  })
  .strict()
  .refine((v) => Object.values(v).some(Boolean));
export const previewSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    presetId: workKindSchema.exclude(["custom"]),
    presetVersion: z.number().int().positive(),
    expectedRevision: z.number().int().nonnegative(),
    locale: localeSchema,
    selection: selectionSchema,
    salesName: name,
    deliveryName: name,
    operations: z
      .array(
        z
          .object({
            kind: z.enum(["pipeline", "deal_field", "activity_type", "work_type"]),
            key: z.string(),
            name: z.string(),
            disposition: z.enum(["create", "reuse", "conflict"]),
            reason: z.string().optional(),
          })
          .strict(),
      )
      .max(40),
    conflicts: z.array(z.string()).max(40),
  })
  .strict();
export type Preview = z.infer<typeof previewSchema>;
export type InstalledResource = {
  kind: "pipeline" | "deal_field" | "activity_type" | "work_type";
  id: string;
  key: string;
  created: boolean;
};
export type Installation = {
  id: string;
  requestId: string;
  presetId: string;
  presetVersion: number;
  createdAt: string;
  undoneAt: string | null;
  resources: InstalledResource[];
};
export const valuesSchema = z.record(
  z.string(),
  z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null()]),
);
export const itemDraftSchema = z
  .object({
    typeId: uuid,
    stageId: uuid,
    title: z.string().trim().min(1).max(240),
    description: z.string().max(20000),
    ownerId: uuid,
    organizationId: uuid.nullable(),
    personId: uuid.nullable(),
    dealId: uuid.nullable(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    visibility: z.enum(["owner", "group", "all"]),
    visibilityGroupId: uuid.nullable(),
    values: valuesSchema,
  })
  .strict()
  .refine((v) =>
    v.visibility === "group" ? v.visibilityGroupId !== null : v.visibilityGroupId === null,
  );
export type ItemDraft = z.infer<typeof itemDraftSchema>;
export type WorkItem = ItemDraft & {
  id: string;
  revision: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};
const base = { requestId: uuid };
const revision = z.number().int().nonnegative();
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("cancel_operation"), targetRequestId: uuid }).strict(),
  z
    .object({
      ...base,
      action: z.literal("save_preferences"),
      expectedRevision: revision,
      preferences: workPreferencesSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("preview"),
      presetId: workKindSchema.exclude(["custom"]),
      locale: localeSchema,
      expectedRevision: revision,
      selection: selectionSchema,
      salesName: name.optional(),
      deliveryName: name.optional(),
    })
    .strict(),
  z.object({ ...base, action: z.literal("apply"), preview: previewSchema }).strict(),
  z.object({ ...base, action: z.literal("undo"), installationId: uuid }).strict(),
  z
    .object({
      ...base,
      action: z.literal("configure_type"),
      id: uuid.optional(),
      expectedRevision: revision,
      name,
      kind: workKindSchema,
      fields: z.array(fieldDefinitionSchema).max(40),
      stages: z.array(stageDraftSchema).min(1).max(30),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("archive_type"),
      id: uuid,
      expectedRevision: revision,
      archived: z.boolean(),
    })
    .strict(),
  z.object({ ...base, action: z.literal("create_item"), item: itemDraftSchema }).strict(),
  z
    .object({
      ...base,
      action: z.literal("update_item"),
      id: uuid,
      expectedRevision: revision,
      item: itemDraftSchema,
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("archive_item"),
      id: uuid,
      expectedRevision: revision,
      archived: z.boolean(),
    })
    .strict(),
]);
export type WorkCommand = z.infer<typeof commandSchema>;
export type WorkErrorCode =
  | "forbidden"
  | "unauthorized"
  | "fresh_auth_required"
  | "invalid_input"
  | "conflict"
  | "not_found"
  | "preview_stale"
  | "replay_conflict"
  | "in_use"
  | "unavailable"
  | "rate_limited";
export type WorkError = { code: WorkErrorCode; id?: string };
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: WorkError };
export type Overview = {
  workspaceScope: string;
  revision: number;
  preferences: WorkPreferences;
  catalog: Preset[];
  workTypes: WorkType[];
  installations: Installation[];
  permissions: {
    manageProfile: boolean;
    apply: boolean;
    view: boolean;
    create: boolean;
    change: boolean;
    manage: boolean;
  };
};
export type WorkOptions = {
  owners: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  persons: { id: string; name: string }[];
  deals: { id: string; title: string }[];
  groups: { id: string; name: string }[];
};
