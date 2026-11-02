import { z } from "zod";
import {
  QUALIFICATION_MAX_CRITERIA,
  QUALIFICATION_MAX_REFERENCES,
  QUALIFICATION_MAX_VERSION,
} from "./qualificationConstants";

const prototypeKeys = new Set(["__proto__", "prototype", "constructor"]);
const stableKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .refine((value) => !prototypeKeys.has(value));
const positiveVersion = z.number().int().positive().max(QUALIFICATION_MAX_VERSION);

function boundedText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    );
}

function localizedText(max: number) {
  const text = boundedText(max);
  return z.strictObject({ fa: text, de: text, en: text }).readonly();
}

const criterion = z
  .strictObject({
    key: stableKey,
    label: localizedText(255),
    description: localizedText(1000),
    prompt: localizedText(1000),
  })
  .readonly();

const reference = z
  .strictObject({
    name: boundedText(80),
    url: z
      .string()
      .max(2048)
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.protocol === "https:" && url.username === "" && url.password === "";
        } catch {
          return false;
        }
      }),
    accessedOn: z.iso.date(),
  })
  .readonly();

export const qualificationDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    definitionKey: stableKey,
    version: positiveVersion,
    title: localizedText(255),
    description: localizedText(1000),
    provenance: z
      .strictObject({
        kind: z.literal("original"),
        sourceKey: stableKey,
        revision: positiveVersion,
        author: stableKey,
        reviewStatus: z.literal("pending"),
      })
      .readonly(),
    research: z
      .strictObject({
        rightsStatus: z.literal("pending"),
        references: z.array(reference).min(1).max(QUALIFICATION_MAX_REFERENCES).readonly(),
      })
      .readonly(),
    criteria: z.array(criterion).min(1).max(QUALIFICATION_MAX_CRITERIA).readonly(),
  })
  .superRefine((definition, context) => {
    if (new Set(definition.criteria.map((item) => item.key)).size !== definition.criteria.length)
      context.addIssue({ code: "custom", path: ["criteria"], message: "Duplicate criterion key" });
  })
  .readonly();

export type QualificationDefinition = z.infer<typeof qualificationDefinitionSchema>;
export type QualificationCriterion = QualificationDefinition["criteria"][number];
