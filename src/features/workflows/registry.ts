import { z } from "zod";
import { customFieldSettingsSchema } from "./configurationBindings";
import { configurationLimits, configurationProfiles } from "./configurationSpec";
import type { ConfigurationProfile } from "./configurationTypes";
import { coarseMappingOutputs, mappingOutputContracts } from "./mappingOutputs";
import type { MappingValueContract } from "./mappingTypes";
import { bindingSchema, type ValueType, type WorkflowNode } from "./schemas";

interface ActionSpec {
  configuration: ConfigurationProfile;
  config: z.ZodType;
  inputs: Record<string, ValueType>;
  outputs: Record<string, ValueType>;
  outputContracts: Record<string, MappingValueContract>;
  effect: "none" | "database" | "wait";
}
const entity = z.enum(["deal", "lead", "person", "organization"]);
export const delayMinutesSchema = z
  .number()
  .int()
  .min(configurationLimits.waitMin)
  .max(configurationLimits.waitMax);
export const conditionConfigSchema = z
  .strictObject({
    left: bindingSchema,
    operator: z.enum(["exists", "equals", "notEquals", "greaterThan", "contains"]),
    right: bindingSchema.optional(),
  })
  .refine((value) => value.operator === "exists" || value.right !== undefined);

export const actionRegistry: Record<WorkflowNode["type"], ActionSpec> = {
  "trigger.manual": {
    configuration: configurationProfiles["trigger.manual"],
    config: z.strictObject({}),
    inputs: {},
    outputs: coarseMappingOutputs("trigger.manual"),
    outputContracts: mappingOutputContracts("trigger.manual"),
    effect: "none",
  },
  "trigger.record": {
    configuration: configurationProfiles["trigger.record"],
    config: z.strictObject({ entity, event: z.enum(["created", "updated", "stageChanged"]) }),
    inputs: {},
    outputs: coarseMappingOutputs("trigger.record"),
    outputContracts: mappingOutputContracts("trigger.record"),
    effect: "none",
  },
  "record.read": {
    configuration: configurationProfiles["record.read"],
    config: z.strictObject({ entity, recordId: bindingSchema }),
    inputs: { recordId: "string" },
    outputs: coarseMappingOutputs("record.read"),
    outputContracts: mappingOutputContracts("record.read"),
    effect: "none",
  },
  "activity.create": {
    configuration: configurationProfiles["activity.create"],
    config: z.strictObject({
      subject: bindingSchema.refine(
        (binding) =>
          binding.kind === "reference" ||
          (typeof binding.value === "string" &&
            binding.value.trim().length > 0 &&
            binding.value.length <= configurationLimits.subjectMax),
      ),
      dealId: bindingSchema.optional(),
      assigneeId: bindingSchema.optional(),
      dueAt: bindingSchema.optional(),
      typeId: z.string().uuid().optional(),
      customFields: customFieldSettingsSchema.optional(),
    }),
    inputs: { subject: "string", dealId: "string", assigneeId: "string", dueAt: "string" },
    outputs: coarseMappingOutputs("activity.create"),
    outputContracts: mappingOutputContracts("activity.create"),
    effect: "database",
  },
  condition: {
    configuration: configurationProfiles.condition,
    config: conditionConfigSchema,
    inputs: {},
    outputs: coarseMappingOutputs("condition"),
    outputContracts: mappingOutputContracts("condition"),
    effect: "none",
  },
  delay: {
    configuration: configurationProfiles.delay,
    config: z.strictObject({
      minutes: bindingSchema.refine(
        (binding) =>
          binding.kind === "reference" || delayMinutesSchema.safeParse(binding.value).success,
      ),
    }),
    inputs: { minutes: "number" },
    outputs: coarseMappingOutputs("delay"),
    outputContracts: mappingOutputContracts("delay"),
    effect: "wait",
  },
  notification: {
    configuration: configurationProfiles.notification,
    config: z.strictObject({ title: bindingSchema }),
    inputs: { title: "string" },
    outputs: coarseMappingOutputs("notification"),
    outputContracts: mappingOutputContracts("notification"),
    effect: "database",
  },
};
