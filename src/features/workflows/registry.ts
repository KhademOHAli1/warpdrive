import { z } from "zod";
import {
  type GroupedConditionConfig,
  type LegacyConditionConfig,
  parseConditionConfig,
} from "./conditionExpression";
import { customFieldSettingsSchema } from "./configurationBindings";
import { configurationLimits, configurationProfiles } from "./configurationSpec";
import type { ConfigurationProfile } from "./configurationTypes";
import {
  delayDurationAmount,
  delayDurationMilliseconds,
  delayDurationUnits,
  delayUntilDate,
} from "./delayConfig";
import { parseIfElseConfig } from "./ifElseConfig";
import { coarseMappingOutputs, mappingOutputContracts } from "./mappingOutputs";
import type { MappingValueContract } from "./mappingTypes";
import { bindingSchema, type ValueType, type WorkflowNode } from "./schemas";
import { workflowCalendarEventConfig } from "./workflowCalendarEventContract";
import { workflowEmailDraftConfig } from "./workflowEmailDraftContract";
import { workflowHumanFormConfig } from "./workflowHumanFormContract";
import { workflowPersonUpsertConfig } from "./workflowPersonUpsertContract";
import { recordCreateConfig } from "./workflowRecordCreateContract";
import { recordDeleteConfig, recordUpdateConfig } from "./workflowRecordMutationContract";
import { recordPickConfig, recordSearchConfig } from "./workflowRecordQueryContract";

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

const durationBinding = bindingSchema.refine(
  (binding) =>
    binding.kind === "reference" ||
    ((binding.literalType === undefined || binding.literalType === "number") &&
      delayDurationAmount(binding.value) !== null),
  "out_of_range",
);

export const delayScheduleConfigSchema = z.discriminatedUnion("delayType", [
  z.strictObject({
    delayType: z.literal("DURATION"),
    duration: z
      .strictObject({
        days: durationBinding.optional(),
        hours: durationBinding.optional(),
        minutes: durationBinding.optional(),
        seconds: durationBinding.optional(),
      })
      .refine((duration) => {
        const minimum = Object.fromEntries(
          delayDurationUnits.map((unit) => {
            const binding = duration[unit];
            return [unit, binding?.kind === "value" ? binding.value : 0];
          }),
        );
        return delayDurationMilliseconds(minimum) !== null;
      }, "out_of_range"),
  }),
  z.strictObject({
    delayType: z.literal("SCHEDULED_DATE"),
    scheduledDateTime: bindingSchema.refine(
      (binding) =>
        binding.kind === "reference" ||
        (binding.literalType === "instant" && delayUntilDate(binding.value) !== null),
      "literal_instant_invalid",
    ),
  }),
]);
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
  ifElse: {
    configuration: configurationProfiles.ifElse,
    config: z.custom((raw) => parseIfElseConfig(raw, "execute").ok),
    inputs: {},
    outputs: coarseMappingOutputs("ifElse"),
    outputContracts: mappingOutputContracts("ifElse"),
    effect: "none",
  },
  "record.create": {
    configuration: configurationProfiles["record.create"],
    config: recordCreateConfig,
    inputs: {},
    outputs: coarseMappingOutputs("record.create"),
    outputContracts: mappingOutputContracts("record.create"),
    effect: "database",
  },
  "record.update": {
    configuration: configurationProfiles["record.update"],
    config: recordUpdateConfig,
    inputs: {},
    outputs: coarseMappingOutputs("record.update"),
    outputContracts: mappingOutputContracts("record.update"),
    effect: "database",
  },
  "record.delete": {
    configuration: configurationProfiles["record.delete"],
    config: recordDeleteConfig,
    inputs: {},
    outputs: coarseMappingOutputs("record.delete"),
    outputContracts: mappingOutputContracts("record.delete"),
    effect: "database",
  },
  "record.search": {
    configuration: configurationProfiles["record.search"],
    config: recordSearchConfig,
    inputs: {},
    outputs: coarseMappingOutputs("record.search"),
    outputContracts: mappingOutputContracts("record.search"),
    effect: "none",
  },
  "record.upsert": {
    configuration: configurationProfiles["record.upsert"],
    config: workflowPersonUpsertConfig,
    inputs: {},
    outputs: coarseMappingOutputs("record.upsert"),
    outputContracts: mappingOutputContracts("record.upsert"),
    effect: "database",
  },
  "record.pick": {
    configuration: configurationProfiles["record.pick"],
    config: recordPickConfig,
    inputs: {},
    outputs: coarseMappingOutputs("record.pick"),
    outputContracts: mappingOutputContracts("record.pick"),
    effect: "none",
  },
  "email.draft": {
    configuration: configurationProfiles["email.draft"],
    config: workflowEmailDraftConfig,
    inputs: {},
    outputs: coarseMappingOutputs("email.draft"),
    outputContracts: mappingOutputContracts("email.draft"),
    effect: "database",
  },
  "calendar.create": {
    configuration: configurationProfiles["calendar.create"],
    config: workflowCalendarEventConfig,
    inputs: {},
    outputs: coarseMappingOutputs("calendar.create"),
    outputContracts: mappingOutputContracts("calendar.create"),
    effect: "database",
  },
  "human.form": {
    configuration: configurationProfiles["human.form"],
    config: workflowHumanFormConfig,
    inputs: {},
    outputs: {},
    outputContracts: {},
    effect: "wait",
  },
  filter: {
    configuration: configurationProfiles.filter,
    config: conditionConfigSchema,
    inputs: {},
    outputs: coarseMappingOutputs("filter"),
    outputContracts: mappingOutputContracts("filter"),
    effect: "none",
  },
  delay: {
    configuration: configurationProfiles.delay,
    config: z.union([
      delayScheduleConfigSchema,
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
    inputs: { minutes: "number", until: "instant", scheduledDateTime: "instant" },
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
