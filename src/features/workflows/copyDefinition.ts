import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { copyCustomFieldSettingsSchema } from "./configurationBindings";
import {
  copyScalarBindingSchema,
  definitionSchema,
  nodeSchema,
  type WorkflowDefinition,
} from "./schemas";

// Keep the reviewed v1 binding keys explicit while reusing their scalar and path guards.
// A missing selection is copyable; mixed branches and undeclared fields are not.
const copyBinding = copyScalarBindingSchema;
const entity = z.enum(["deal", "lead", "person", "organization"]);

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
    type: z.literal("condition"),
    config: z
      .strictObject({
        left: copyBinding,
        operator: z.enum(["exists", "equals", "notEquals", "greaterThan", "contains"]),
        right: copyBinding,
      })
      .partial(),
  }),
  nodeSchema.extend({
    type: z.literal("delay"),
    config: z.strictObject({ minutes: copyBinding }).partial(),
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
