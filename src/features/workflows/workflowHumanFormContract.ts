import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import type { MappingValueContract } from "./mappingTypes";
import type { StepOutput } from "./runTypes";

export const workflowHumanFormLimits = {
  fields: 8,
  label: 120,
  placeholder: 120,
  instructions: 2_000,
  text: 2_000,
} as const;

export const workflowHumanFormTypes = ["text", "number", "date"] as const;
export const workflowHumanFormType = z.enum(workflowHumanFormTypes);
export type WorkflowHumanFormType = z.infer<typeof workflowHumanFormType>;

const noNul = (value: string) => !value.includes("\0");
const fieldBase = {
  id: z.uuid().refine((value) => value === value.toLowerCase()),
  label: z.string().max(workflowHumanFormLimits.label).refine(noNul),
  required: z.boolean(),
};
const formField = z.discriminatedUnion("type", [
  z.strictObject({
    ...fieldBase,
    type: z.enum(["text", "number"]),
    placeholder: z.string().max(workflowHumanFormLimits.placeholder).refine(noNul).optional(),
  }),
  z.strictObject({ ...fieldBase, type: z.literal("date") }),
]);
export type WorkflowHumanFormField = z.infer<typeof formField>;

export const workflowHumanFormDraftConfig = z.strictObject({
  instructions: z.string().max(workflowHumanFormLimits.instructions).refine(noNul).optional(),
  fields: z
    .unknown()
    .refine((value) => Array.isArray(value) && value.length <= workflowHumanFormLimits.fields)
    .pipe(z.array(formField))
    .refine((fields) => new Set(fields.map(({ id }) => id)).size === fields.length),
});

// Suitable for checking a draft before the graph's recursive JSON validation.
export function boundedWorkflowHumanFormConfig(raw: unknown): boolean {
  return workflowHumanFormDraftConfig.safeParse(raw).success;
}

export const workflowHumanFormConfig = workflowHumanFormDraftConfig.superRefine(
  (config, context) => {
    if (config.fields.length === 0) {
      context.addIssue({ code: "custom", path: ["fields"], message: "required" });
    }
    const labels = new Set<string>();
    for (const [index, field] of config.fields.entries()) {
      const label = field.label.normalize("NFKC").trim().toLowerCase();
      if (label === "" || labels.has(label)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "label"],
          message: label === "" ? "required" : "invalid_value",
        });
      }
      labels.add(label);
    }
  },
);

export type WorkflowHumanFormConfig = z.infer<typeof workflowHumanFormConfig>;

export interface WorkflowHumanFormOutputDescriptor {
  path: readonly ["answers", string];
  label: string;
  contract: MappingValueContract;
}

export function workflowHumanFormOutputDescriptors(
  raw: unknown,
): WorkflowHumanFormOutputDescriptor[] {
  const config = workflowHumanFormConfig.safeParse(raw);
  if (!config.success) return [];
  return config.data.fields.map(({ id, label, type, required }) => ({
    path: ["answers", id],
    label: label.trim(),
    contract: { kind: type, nullable: !required },
  }));
}

export type WorkflowHumanFormAnswerIssue =
  | { code: "invalid_submission" | "unknown_field" }
  | { code: "required" | "invalid_value"; fieldId: string };

const answerSchemas = {
  text: z.string().max(workflowHumanFormLimits.text).refine(noNul),
  number: z.number().finite(),
  date: z.iso.date(),
};

function plainRecord(raw: unknown): raw is Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const prototype = Reflect.getPrototypeOf(raw);
  return prototype === Object.prototype || prototype === null;
}

function answerValue(field: WorkflowHumanFormField, raw: unknown) {
  const result = raw === null ? null : answerSchemas[field.type].safeParse(raw);
  if (result?.success === false) return err("invalid_value" as const);
  const value = result?.data ?? null;
  if (value === null || (field.type === "text" && typeof value === "string" && value.trim() === ""))
    return field.required ? err("required" as const) : ok(null);
  return ok(value);
}

// The runtime must authorize the submission against the pinned form first. Return only
// typed answer keys for that step, and keep private values out of errors and draft config.
export function parseWorkflowHumanFormAnswers(
  config: WorkflowHumanFormConfig,
  raw: unknown,
): Result<StepOutput, WorkflowHumanFormAnswerIssue> {
  if (!plainRecord(raw)) return err({ code: "invalid_submission" });
  const keys = Object.keys(raw);
  if (keys.length > workflowHumanFormLimits.fields) return err({ code: "invalid_submission" });
  const ids = new Set(config.fields.map(({ id }) => id));
  if (keys.some((key) => !ids.has(key))) return err({ code: "unknown_field" });

  const answers: StepOutput = {};
  for (const field of config.fields) {
    const value = answerValue(field, Object.hasOwn(raw, field.id) ? raw[field.id] : null);
    if (!value.ok) return err({ code: value.error, fieldId: field.id });
    answers[`answers.${field.id}`] = value.value;
  }
  return ok(answers);
}
