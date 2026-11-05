import { z } from "zod";
import {
  fieldDefinitionSchema,
  type Installation,
  itemDraftSchema,
  type Overview,
  type Preset,
  stageDraftSchema,
  type WorkItem,
  type WorkOptions,
  type WorkType,
  workKindSchema,
  workPreferencesSchema,
} from "./model-contracts";

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(120);
const revision = z.number().int().nonnegative();
export const workStageSchema = stageDraftSchema.extend({
  id: uuid,
  order: z.number().int(),
  isArchived: z.boolean(),
});
export const workTypeSchema: z.ZodType<WorkType> = z
  .object({
    id: uuid,
    key: z.string(),
    name,
    kind: workKindSchema,
    revision: z.number().int().positive(),
    fields: z.array(fieldDefinitionSchema),
    stages: z.array(workStageSchema),
    isArchived: z.boolean(),
  })
  .strict();
export const installedResourceSchema = z
  .object({
    kind: z.enum(["pipeline", "deal_field", "activity_type", "work_type"]),
    id: uuid,
    key: z.string(),
    created: z.boolean(),
  })
  .strict();
export const installationSchema: z.ZodType<Installation> = z
  .object({
    id: uuid,
    requestId: uuid,
    presetId: z.string(),
    presetVersion: z.number().int(),
    createdAt: z.string(),
    undoneAt: z.string().nullable(),
    resources: z.array(installedResourceSchema),
  })
  .strict();
export const workItemSchema: z.ZodType<WorkItem> = itemDraftSchema.safeExtend({
  id: uuid,
  revision: z.number().int().positive(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const idName = z.object({ id: uuid, name: z.string() }).strict();
export const optionsSchema: z.ZodType<WorkOptions> = z
  .object({
    owners: z.array(idName),
    organizations: z.array(idName),
    persons: z.array(idName),
    deals: z.array(z.object({ id: uuid, title: z.string() }).strict()),
    groups: z.array(idName),
  })
  .strict();
export const presetSchema: z.ZodType<Preset> = z
  .object({
    id: workKindSchema.exclude(["custom"]),
    version: z.number().int(),
    name: z.string(),
    description: z.string(),
    sales: z.object({ name: z.string(), stages: z.array(z.string()) }).strict(),
    delivery: z
      .object({
        name: z.string(),
        stages: z.array(stageDraftSchema),
        fields: z.array(fieldDefinitionSchema),
      })
      .strict(),
    dealFields: z.array(
      z
        .object({ key: z.string(), name: z.string(), type: z.enum(["text", "numeric", "date"]) })
        .strict(),
    ),
    activityTypes: z.array(
      z.object({ key: z.string(), name: z.string(), icon: z.string() }).strict(),
    ),
  })
  .strict();
export const overviewSchema: z.ZodType<Overview> = z
  .object({
    workspaceScope: uuid,
    revision,
    preferences: workPreferencesSchema,
    catalog: z.array(presetSchema),
    workTypes: z.array(workTypeSchema),
    installations: z.array(installationSchema),
    permissions: z
      .object({
        manageProfile: z.boolean(),
        apply: z.boolean(),
        view: z.boolean(),
        create: z.boolean(),
        change: z.boolean(),
        manage: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const itemsPageSchema = z
  .object({ items: z.array(workItemSchema), nextCursor: z.string().nullable() })
  .strict();
export const preferencesAckSchema = z
  .object({ revision, preferences: workPreferencesSchema })
  .strict();
export const applyAckSchema = z
  .object({ installation: installationSchema, revision, workTypes: z.array(workTypeSchema) })
  .strict();
export const undoAckSchema = z.object({ installation: installationSchema, revision }).strict();

export const operationAckSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("complete"), data: z.unknown() }).strict(),
  z.object({ status: z.literal("canceled"), requestId: uuid }).strict(),
]);
export const cancelOperationAckSchema = operationAckSchema;
