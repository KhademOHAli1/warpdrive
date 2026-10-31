import { z } from "zod";
import { bindingSchema, type ValueType, type WorkflowNode } from "./schemas";

interface ActionSpec {
  config: z.ZodType;
  inputs: Record<string, ValueType>;
  outputs: Record<string, ValueType>;
  effect: "none" | "database" | "wait";
}
const entity = z.enum(["deal", "lead", "person", "organization"]);
export const conditionConfigSchema = z
  .strictObject({
    left: bindingSchema,
    operator: z.enum(["exists", "equals", "notEquals", "greaterThan", "contains"]),
    right: bindingSchema.optional(),
  })
  .refine((value) => value.operator === "exists" || value.right !== undefined);
const recordOutputs: Record<string, ValueType> = {
  id: "string",
  title: "string",
  ownerId: "string",
  stageId: "string",
  status: "string",
  value: "decimal",
  currency: "string",
};

export const actionRegistry: Record<WorkflowNode["type"], ActionSpec> = {
  "trigger.manual": {
    config: z.strictObject({}),
    inputs: {},
    outputs: { recordId: "string" },
    effect: "none",
  },
  "trigger.record": {
    config: z.strictObject({ entity, event: z.enum(["created", "updated", "stageChanged"]) }),
    inputs: {},
    outputs: { recordId: "string", eventId: "string" },
    effect: "none",
  },
  "record.read": {
    config: z.strictObject({ entity, recordId: bindingSchema }),
    inputs: { recordId: "string" },
    outputs: recordOutputs,
    effect: "none",
  },
  "activity.create": {
    config: z.strictObject({
      subject: bindingSchema.refine(
        (binding) =>
          binding.kind === "reference" ||
          (typeof binding.value === "string" &&
            binding.value.trim().length > 0 &&
            binding.value.length <= 255),
      ),
      dealId: bindingSchema.optional(),
      assigneeId: bindingSchema.optional(),
      dueAt: bindingSchema.optional(),
      typeId: z.string().uuid().optional(),
    }),
    inputs: { subject: "string", dealId: "string", assigneeId: "string", dueAt: "string" },
    outputs: { id: "string" },
    effect: "database",
  },
  condition: {
    config: conditionConfigSchema,
    inputs: {},
    outputs: { result: "boolean" },
    effect: "none",
  },
  delay: {
    config: z.strictObject({ minutes: bindingSchema }),
    inputs: { minutes: "number" },
    outputs: { resumeAt: "string" },
    effect: "wait",
  },
  notification: {
    config: z.strictObject({ title: bindingSchema }),
    inputs: { title: "string" },
    outputs: { id: "string" },
    effect: "database",
  },
};
