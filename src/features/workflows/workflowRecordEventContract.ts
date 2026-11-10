import { z } from "zod";
import { DEAL_STATUS } from "@/constants/dealStatus";
import { canonicalMoney } from "@/lib/canonicalMoney";

export const workflowRecordEventKinds = ["created", "updated", "deleted", "upserted"] as const;
export const workflowRecordEventFields = [
  "status",
  "pipelineId",
  "stageId",
  "value",
  "currency",
  "expectedCloseDate",
] as const;
export const workflowRecordEventKind = z.enum(workflowRecordEventKinds);
export const workflowRecordEventField = z.enum(workflowRecordEventFields);
export type WorkflowRecordEventKind = z.infer<typeof workflowRecordEventKind>;
export type WorkflowRecordEventField = z.infer<typeof workflowRecordEventField>;
const id = z.uuid().toLowerCase();

const snapshotFields = {
  status: z.enum(DEAL_STATUS),
  pipelineId: id,
  stageId: id,
  value: z
    .string()
    .regex(/^-?\d{1,14}(?:\.\d{1,4})?$/)
    .nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  expectedCloseDate: z.iso.date().nullable(),
};

// Only workflow-safe Deal fields enter the immutable event payload. Ownership,
// titles, contacts, notes and custom fields are never projected by this adapter.
export const workflowRecordEventSnapshot = z.strictObject(snapshotFields);
export type WorkflowRecordEventSnapshot = z.infer<typeof workflowRecordEventSnapshot>;

export const workflowRecordEventWatchFields = z
  .array(workflowRecordEventField)
  .max(workflowRecordEventFields.length)
  .refine((fields) => new Set(fields).size === fields.length);

const predicate = z
  .strictObject({
    side: z.enum(["before", "after"]),
    field: workflowRecordEventField,
    operator: z.enum(["equals", "notEquals", "exists", "isEmpty"]),
    value: z.string().max(64).nullable().optional(),
  })
  .refine(({ field, operator, value }) =>
    operator === "exists" || operator === "isEmpty"
      ? value === undefined
      : snapshotFields[field].safeParse(value).success,
  );

const filter = z.strictObject({
  operator: z.enum(["and", "or"]),
  predicates: z.array(predicate).min(1).max(12),
});

export const workflowRecordEventTriggerConfig = z
  .strictObject({
    entity: z.literal("deal"),
    event: z.union([workflowRecordEventKind, z.literal("stageChanged")]),
    match: z
      .strictObject({
        fields: workflowRecordEventWatchFields.nullable().optional(),
        filter: filter.optional(),
      })
      .optional(),
  })
  .refine(
    ({ event, match }) => match?.fields == null || event === "updated" || event === "upserted",
  );

export type WorkflowRecordEventTriggerConfig = z.infer<typeof workflowRecordEventTriggerConfig>;

export const workflowRecordEventLaunch = z.strictObject({
  kind: z.literal("record-event"),
  eventId: id,
  recordId: id,
  event: workflowRecordEventKind,
});
export type WorkflowRecordEventLaunch = z.infer<typeof workflowRecordEventLaunch>;

export interface WorkflowRecordEventData {
  eventId: string;
  recordId: string;
  kind: WorkflowRecordEventKind;
  occurredAt: Date;
  before: WorkflowRecordEventSnapshot | null;
  after: WorkflowRecordEventSnapshot | null;
  changedFields: WorkflowRecordEventField[];
}

function predicateMatches(
  event: WorkflowRecordEventData,
  rule: z.infer<typeof predicate>,
): boolean {
  const snapshot = event[rule.side];
  if (snapshot === null) return false;
  const value = snapshot[rule.field];
  const expected =
    typeof rule.value === "string" && rule.field === "value"
      ? canonicalMoney(rule.value)
      : rule.field === "pipelineId" || rule.field === "stageId"
        ? rule.value?.toLowerCase()
        : rule.value;
  const actual =
    typeof value === "string" && rule.field === "value" ? canonicalMoney(value) : value;
  switch (rule.operator) {
    case "exists":
      return value !== null;
    case "isEmpty":
      return value === null;
    case "equals":
      return actual === expected;
    case "notEquals":
      return actual !== expected;
  }
}

export function readWorkflowRecordEventTrigger(definition: {
  nodes: readonly { id: string; type: string; version: number; config: unknown }[];
}) {
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  const trigger = triggers[0];
  if (triggers.length !== 1 || trigger?.type !== "trigger.record" || trigger.version !== 1)
    return null;
  const config = workflowRecordEventTriggerConfig.safeParse(trigger.config);
  return config.success ? { id: trigger.id, config: config.data } : null;
}

export function readWorkflowRecordEventLaunch(
  definition: Parameters<typeof readWorkflowRecordEventTrigger>[0],
  raw: unknown,
): WorkflowRecordEventLaunch | null {
  const trigger = readWorkflowRecordEventTrigger(definition);
  const parsed = workflowRecordEventLaunch.safeParse(raw);
  if (trigger === null || !parsed.success) return null;
  const kind = trigger.config.event === "stageChanged" ? "updated" : trigger.config.event;
  return parsed.data.event === kind ? parsed.data : null;
}

export function workflowRecordEventMatches(
  config: WorkflowRecordEventTriggerConfig,
  event: WorkflowRecordEventData,
): boolean {
  const kind = config.event === "stageChanged" ? "updated" : config.event;
  if (kind !== event.kind) return false;
  const watched = config.event === "stageChanged" ? ["stageId" as const] : config.match?.fields;
  if (
    watched != null &&
    watched.length !== 0 &&
    !watched.some((field) => event.changedFields.includes(field))
  )
    return false;
  const rules = config.match?.filter;
  if (rules === undefined) return true;
  return rules.operator === "and"
    ? rules.predicates.every((rule) => predicateMatches(event, rule))
    : rules.predicates.some((rule) => predicateMatches(event, rule));
}

export function workflowRecordEventOutput(event: WorkflowRecordEventData) {
  const output: Record<string, string | null> = {
    eventId: event.eventId,
    recordId: event.recordId,
    eventName: `deal.${event.kind}`,
    occurredAt: event.occurredAt.toISOString(),
  };
  for (const side of ["before", "after"] as const) {
    const snapshot = event[side];
    if (snapshot === null) continue;
    for (const field of workflowRecordEventFields) output[`${side}.${field}`] = snapshot[field];
  }
  return output;
}
