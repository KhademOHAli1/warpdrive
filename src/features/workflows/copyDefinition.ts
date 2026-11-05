import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { activityReminderTimeZone } from "@/features/activities/reminderIntentTypes";
import { parseConditionConfig } from "./conditionExpression";
import { copyCustomFieldSettingsSchema } from "./configurationBindings";
import { boundedDelayConfig } from "./delayConfig";
import { parseIfElseConfig } from "./ifElseConfig";
import {
  copyScalarBindingSchema,
  definitionSchema,
  nodeSchema,
  type WorkflowDefinition,
} from "./schemas";
import { workflowHumanFormDraftConfig } from "./workflowHumanFormContract";
import { recordCreateEntitySchema, recordCreateFields } from "./workflowRecordCreateContract";
import { recordUpdateFields } from "./workflowRecordMutationContract";
import { recordPickDraftConfig, recordSearchDraftConfig } from "./workflowRecordQueryContract";

// Keep the reviewed v1 binding keys explicit while reusing their scalar and path guards.
// A missing selection is copyable; mixed branches and undeclared fields are not.
const copyBinding = copyScalarBindingSchema;
const entity = z.enum(["deal", "lead", "person", "organization"]);

const copyCreateRecord = z
  .strictObject({
    entity: recordCreateEntitySchema.optional(),
    fields: z.record(z.string().min(1).max(32), copyBinding).optional(),
  })
  .refine((config) =>
    Object.keys(config.fields ?? {}).every(
      (key) =>
        config.entity !== undefined &&
        recordCreateFields[config.entity].some((field) => field.key === key),
    ),
  );

const copyRecordTarget = z.strictObject({
  entity: recordCreateEntitySchema.optional(),
  recordId: copyBinding.optional(),
});
const copyUpdateRecord = copyRecordTarget
  .extend({
    fields: z.record(z.string().min(1).max(32), copyBinding).optional(),
  })
  .refine((config) =>
    Object.keys(config.fields ?? {}).every(
      (key) =>
        config.entity !== undefined &&
        recordUpdateFields[config.entity].some((field) => field.key === key),
    ),
  );

// These are copy shapes, not publication requirements. Every known config field may
// be incomplete, but new actions, versions, credentials, and identity fields need review.
const copyNode = z.discriminatedUnion("type", [
  nodeSchema.extend({ type: z.literal("trigger.manual"), config: z.strictObject({}) }),
  nodeSchema.extend({
    type: z.literal("trigger.record"),
    config: z
      .strictObject({ entity, event: z.enum(["created", "updated", "stageChanged"]) })
      .partial(),
  }),
  nodeSchema.extend({
    type: z.literal("record.read"),
    config: z.strictObject({ entity, recordId: copyBinding }).partial(),
  }),
  nodeSchema.extend({ type: z.literal("record.create"), config: copyCreateRecord }),
  nodeSchema.extend({ type: z.literal("record.update"), config: copyUpdateRecord }),
  nodeSchema.extend({ type: z.literal("record.delete"), config: copyRecordTarget }),
  nodeSchema.extend({ type: z.literal("record.search"), config: recordSearchDraftConfig }),
  nodeSchema.extend({
    type: z.literal("record.upsert"),
    config: z
      .strictObject({
        entity: z.literal("person"),
        key: copyBinding,
        fields: z
          .strictObject({
            name: copyBinding,
            firstName: copyBinding,
            lastName: copyBinding,
            orgId: copyBinding,
          })
          .partial(),
      })
      .partial(),
  }),
  nodeSchema.extend({ type: z.literal("record.pick"), config: recordPickDraftConfig }),
  nodeSchema.extend({
    type: z.literal("email.draft"),
    config: z.strictObject({
      accountId: z.uuid().optional(),
      to: copyBinding.optional(),
      cc: copyBinding.optional(),
      bcc: copyBinding.optional(),
      subject: copyBinding.optional(),
      body: copyBinding.optional(),
    }),
  }),
  nodeSchema.extend({
    type: z.literal("calendar.create"),
    config: z
      .strictObject({
        allDay: z.boolean(),
        timeZone: activityReminderTimeZone,
        title: copyBinding,
        startsAt: copyBinding,
        endsAt: copyBinding,
        description: copyBinding,
        location: copyBinding,
      })
      .partial(),
  }),
  nodeSchema.extend({ type: z.literal("human.form"), config: workflowHumanFormDraftConfig }),
  nodeSchema.extend({
    type: z.literal("ifElse"),
    config: z.custom<WorkflowDefinition["nodes"][number]["config"]>(
      (raw) =>
        (raw !== null &&
          typeof raw === "object" &&
          !Array.isArray(raw) &&
          Object.keys(raw).length === 0) ||
        parseIfElseConfig(raw, "copy").ok,
    ),
  }),
  nodeSchema.extend({
    type: z.literal("activity.create"),
    config: z
      .strictObject({
        subject: copyBinding,
        customFields: copyCustomFieldSettingsSchema,
        dealId: copyBinding,
        assigneeId: copyBinding,
        dueAt: copyBinding,
        typeId: z.string().uuid(),
      })
      .partial(),
  }),
  nodeSchema.extend({
    type: z.enum(["condition", "filter"]),
    // The shared parser bounds grouped input before walking it. Keep reviewed
    // incomplete/raw drafts byte-for-byte; publication has separate requirements.
    config: z.custom<WorkflowDefinition["nodes"][number]["config"]>(
      (raw) => parseConditionConfig(raw, "copy").ok,
    ),
  }),
  nodeSchema.extend({
    type: z.literal("delay"),
    config: z.union([
      z.strictObject({ minutes: copyBinding }).partial(),
      z.custom<WorkflowDefinition["nodes"][number]["config"]>(
        (raw) =>
          raw !== null &&
          typeof raw === "object" &&
          (Object.hasOwn(raw, "until") || Object.hasOwn(raw, "delayType")) &&
          boundedDelayConfig(raw),
      ),
    ]),
  }),
  nodeSchema.extend({
    type: z.literal("notification"),
    config: z.strictObject({ title: copyBinding }).partial(),
  }),
]);
const copySchema = definitionSchema.extend({ nodes: z.array(copyNode).min(1).max(100) });

type CopyResult =
  | { ok: true; value: WorkflowDefinition }
  | {
      ok: false;
      error: typeof ERROR_IDS.WORKFLOW_NOT_READY;
      reason: "copy-unavailable";
    };

function unavailable(): CopyResult {
  return { ok: false, error: ERROR_IDS.WORKFLOW_NOT_READY, reason: "copy-unavailable" };
}

export function copyWorkflowDefinition(raw: unknown): CopyResult {
  const reviewed = copySchema.safeParse(raw);
  if (!reviewed.success) return unavailable();
  // Optional copy fields retain explicit undefined during parsing. The persisted JSON
  // boundary rejects those values, rather than dropping or completing authored input.
  const definition = definitionSchema.safeParse(reviewed.data);
  if (!definition.success) return unavailable();
  return { ok: true, value: structuredClone(definition.data) };
}
