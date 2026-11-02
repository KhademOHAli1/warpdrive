import { z } from "zod";
import {
  POSTGRES_INTEGER_MAX,
  STAGE_TEMPLATE_CAPABILITIES,
  TEMPLATE_MAX_REQUIREMENTS,
  TEMPLATE_MAX_STAGES,
} from "./templateConstants";

const stableKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const capabilityKey = z
  .string()
  .max(96)
  .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/);

function localizedText(max: number) {
  const text = z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0);
  return z.strictObject({ fa: text, de: text, en: text }).readonly();
}

const stage = z
  .strictObject({
    key: stableKey,
    name: localizedText(255),
    description: localizedText(1000),
    rottingDays: z.number().int().positive().max(POSTGRES_INTEGER_MAX).nullable(),
  })
  .readonly();

export const processTemplateManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    templateKey: stableKey,
    version: z.number().int().positive().max(POSTGRES_INTEGER_MAX),
    title: localizedText(255),
    description: localizedText(1000),
    provenance: z
      .strictObject({
        kind: z.literal("original"),
        sourceKey: stableKey,
        revision: z.number().int().positive().max(POSTGRES_INTEGER_MAX),
      })
      .readonly(),
    requires: z.array(capabilityKey).min(1).max(TEMPLATE_MAX_REQUIREMENTS).readonly(),
    pipeline: z.strictObject({ name: localizedText(255) }).readonly(),
    stages: z.array(stage).min(1).max(TEMPLATE_MAX_STAGES).readonly(),
    // No field/rule/action execution contract is qualified in this schema version.
    fieldReferences: z.tuple([]).readonly(),
    rules: z.tuple([]).readonly(),
    actions: z.tuple([]).readonly(),
  })
  .superRefine((manifest, ctx) => {
    if (new Set(manifest.stages.map((item) => item.key)).size !== manifest.stages.length)
      ctx.addIssue({ code: "custom", path: ["stages"], message: "Duplicate stage key" });
    if (new Set(manifest.requires).size !== manifest.requires.length)
      ctx.addIssue({ code: "custom", path: ["requires"], message: "Duplicate capability" });
    if (STAGE_TEMPLATE_CAPABILITIES.some((key) => !manifest.requires.includes(key)))
      ctx.addIssue({ code: "custom", path: ["requires"], message: "Missing stage capability" });
  })
  .readonly();

export type ProcessTemplateManifest = z.infer<typeof processTemplateManifestSchema>;
