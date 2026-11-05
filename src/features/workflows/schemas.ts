import { z } from "zod";
import { boundedConditionConfig } from "./conditionExpressionBudget";
import { configurationLimits } from "./configurationLimits";
import { boundedDelayConfig } from "./delayConfig";
import { boundedIfElseConfig, branchPortSchema } from "./ifElseBudget";
import { scalarLiteralTypes, validateLiteralIntent } from "./mappingLiteralIntent";
import { boundedWorkflowHumanFormConfig } from "./workflowHumanFormContract";
import { boundedRecordLookupConfig } from "./workflowRecordQueryBounds";

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const property = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => !["__proto__", "prototype", "constructor"].includes(value));

const draftValueBindingSchema = z.strictObject({
  kind: z.literal("value"),
  value: z.union([z.string().max(50_000), z.number().finite(), z.boolean(), z.null()]),
  literalType: z.enum(scalarLiteralTypes).optional(),
});
const referenceBindingSchema = z.strictObject({
  kind: z.literal("reference"),
  nodeId: identifier,
  path: z.array(property).min(1).max(8),
});
export const draftBindingSchema = z.discriminatedUnion("kind", [
  draftValueBindingSchema,
  referenceBindingSchema,
]);
export const bindingSchema = z.discriminatedUnion("kind", [
  draftValueBindingSchema.superRefine((literal, context) => {
    const issue = validateLiteralIntent(literal);
    if (issue !== null) context.addIssue({ code: "custom", path: ["value"], message: issue });
  }),
  referenceBindingSchema,
]);
export const copyScalarBindingSchema = z.union([
  draftValueBindingSchema.partial(),
  referenceBindingSchema.extend({ path: z.array(property).max(8) }).partial(),
]);
export type DraftBinding = z.infer<typeof draftBindingSchema>;
export type DraftValueBinding = Extract<DraftBinding, { kind: "value" }>;
export type ReferenceBinding = Extract<DraftBinding, { kind: "reference" }>;
export type Binding = z.infer<typeof bindingSchema>;
export type ValueType = "string" | "number" | "boolean" | "decimal" | "date" | "instant";

export const nodeTypes = [
  "trigger.manual",
  "trigger.record",
  "record.read",
  "record.create",
  "record.update",
  "record.delete",
  "record.search",
  "record.upsert",
  "record.pick",
  "email.draft",
  "calendar.create",
  "human.form",
  "activity.create",
  "condition",
  "ifElse",
  "filter",
  "delay",
  "notification",
] as const;

export const nodeSchema = z.strictObject({
  id: identifier,
  type: z.enum(nodeTypes),
  version: z.literal(1),
  name: z.string().trim().min(configurationLimits.nameMin).max(configurationLimits.nameMax),
  nameMode: z.enum(["automatic", "custom"]).optional(),
  config: z
    .unknown()
    .refine(boundedConditionConfig, "Condition expression exceeds safe bounds")
    .refine(
      (raw) =>
        !(
          raw !== null &&
          typeof raw === "object" &&
          (Object.hasOwn(raw, "branches") || Object.hasOwn(raw, "fallbackId"))
        ) || boundedIfElseConfig(raw),
      "If/Else routes exceed safe bounds",
    )
    .refine(boundedDelayConfig, "Delay settings exceed safe bounds")
    .refine(boundedRecordLookupConfig, "Record lookup settings exceed safe bounds")
    .refine((raw) => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return true;
      const fields: unknown = Reflect.get(raw, "fields");
      return (
        !(Object.hasOwn(raw, "instructions") || Array.isArray(fields)) ||
        boundedWorkflowHumanFormConfig(raw)
      );
    }, "Form settings exceed safe bounds")
    .pipe(z.record(z.string(), z.json())),
});

export const workflowPortSchema = z.union([z.enum(["next", "true", "false"]), branchPortSchema]);

export const definitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  layout: z
    .record(
      identifier,
      z.strictObject({
        x: z.number().finite().min(-100000).max(100000),
        y: z.number().finite().min(-100000).max(100000),
        anchor: z.literal("center").optional(),
      }),
    )
    .refine((positions) => Object.keys(positions).length <= 100)
    .optional(),
  nodes: z.array(nodeSchema).min(1).max(100),
  edges: z
    .array(
      z.strictObject({
        from: identifier,
        to: identifier,
        port: workflowPortSchema,
      }),
    )
    .max(200),
});

export type WorkflowDefinition = z.infer<typeof definitionSchema>;
export type WorkflowNode = z.infer<typeof nodeSchema>;
export type WorkflowEdge = WorkflowDefinition["edges"][number];
export interface NodePosition {
  x: number;
  y: number;
  // Existing stored coordinates without a marker keep their original top-left anchor.
  anchor?: "center";
}
export interface DefinitionIssue {
  code: string;
  nodeId?: string;
  field?: string;
  path?: readonly string[];
}
