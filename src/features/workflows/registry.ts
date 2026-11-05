import { z } from "zod";
import {
  type GroupedConditionConfig,
  type LegacyConditionConfig,
  parseConditionConfig,
} from "./conditionExpression";
import { customFieldSettingsSchema } from "./configurationBindings";
import { configurationLimits, configurationProfiles } from "./configurationSpec";
import type { ConfigurationProfile } from "./configurationTypes";
import { delayUntilDate } from "./delayConfig";
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
export const conditionConfigSchema = z.unknown().transform((raw, context) => {
  const parsed = parseConditionConfig(raw, "execute");
  if (!parsed.ok) {
    for (const issue of parsed.error)
      context.addIssue({ code: "custom", path: [...issue.path], message: issue.code });
    return z.NEVER;
  }
  return parsed.value.config as LegacyConditionConfig | GroupedConditionConfig;
});

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
    config: z.union([
      z.strictObject({
        minutes: bindingSchema.refine(
          (binding) =>
            binding.kind === "reference" || delayMinutesSchema.safeParse(binding.value).success,
        ),
      }),
      z.strictObject({
        until: bindingSchema.refine(
          (binding) =>
            binding.kind === "value" &&
            binding.literalType === "instant" &&
            delayUntilDate(binding.value) !== null,
        ),
      }),
    ]),
    inputs: { minutes: "number", until: "instant" },
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
