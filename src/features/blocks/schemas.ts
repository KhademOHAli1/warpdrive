import { z } from "zod";
import {
  ACTION_BLOCK_KINDS,
  type BlockJson,
  TRIGGER_BLOCK_KINDS,
  type WorkflowV2Definition,
} from "./contracts";

const rawBlockJsonSchema: z.ZodType<BlockJson> = z.lazy(() =>
  z.union([
    z.string().max(100_000),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(rawBlockJsonSchema).max(10_000),
    z.record(z.string().max(200), rawBlockJsonSchema),
  ]),
);
export const blockJsonSchema = z.preprocess(
  (value) => (boundedBlockJson(value) ? value : undefined),
  rawBlockJsonSchema,
);
export const blockOutputSchema = z.preprocess(
  (value) => (boundedBlockJson(value) ? value : undefined),
  z.record(z.string().max(200), rawBlockJsonSchema),
);
function jsonChildren(value: object): unknown[] | null {
  if (Array.isArray(value)) return value as unknown[];
  if (Object.getPrototypeOf(value) !== Object.prototype) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([key]) => ["__proto__", "constructor", "prototype"].includes(key))) return null;
  return entries.map(([, child]) => child);
}
export function boundedBlockJson(raw: unknown): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value: raw, depth: 0 }];
  let count = 0;
  for (let entry = stack.pop(); entry !== undefined; entry = stack.pop()) {
    if (++count > 25_000 || entry.depth > 25) return false;
    const value = entry.value;
    if (value !== null && typeof value === "object") {
      const children = jsonChildren(value);
      if (children === null) return false;
      for (const child of children) stack.push({ value: child, depth: entry.depth + 1 });
    } else if (value !== null && !["string", "number", "boolean"].includes(typeof value))
      return false;
  }
  return true;
}
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const definitionV2Schema: z.ZodType<WorkflowV2Definition> = z.strictObject({
  schemaVersion: z.literal(2),
  trigger: z.strictObject({ type: z.enum(TRIGGER_BLOCK_KINDS), config: blockOutputSchema }),
  nodes: z
    .array(
      z.strictObject({
        id,
        type: z.enum(ACTION_BLOCK_KINDS),
        version: z.literal(1),
        name: z.string().trim().min(1).max(100),
        config: blockOutputSchema,
      }),
    )
    .max(100),
  edges: z
    .array(z.strictObject({ id, source: id, target: id, sourcePort: z.string().min(1).max(100) }))
    .max(200),
  entryNodeIds: z.array(id).max(20),
  layout: z
    .record(
      z.union([id, z.literal("$trigger")]),
      z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
    )
    .optional(),
});

const objectName = z.enum(["deal", "lead", "person", "organization", "activity"]);
const recordId = z.uuid();
const fields = blockOutputSchema;
export const conditionSchema: z.ZodType<BlockJson> = z.lazy(() =>
  z.union([
    z.strictObject({
      combinator: z.enum(["and", "or"]),
      conditions: z.array(conditionSchema).min(1).max(40),
    }),
    z.strictObject({
      left: blockJsonSchema,
      operator: z.enum([
        "eq",
        "ne",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "starts_with",
        "in",
        "is_empty",
        "is_not_empty",
      ]),
      right: blockJsonSchema.optional(),
    }),
  ]),
);
const formField = z
  .object({
    id,
    name: id,
    label: z.string().min(1).max(200),
    type: z.enum(["TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT", "RECORD"]),
    required: z.boolean().optional(),
    options: z.array(z.string().max(200)).max(100).optional(),
    objectName: objectName.optional(),
  })
  .passthrough();
const configs = {
  CREATE_RECORD: z.object({ objectName, fields }),
  UPDATE_RECORD: z.object({ objectName, recordId, fields }),
  DELETE_RECORD: z.object({ objectName, recordId }),
  UPSERT_RECORD: z.object({
    objectName,
    matchField: z.string().min(1).max(100),
    matchValue: blockJsonSchema,
    fields,
  }),
  FIND_RECORDS: z.object({
    objectName,
    filters: blockJsonSchema.optional(),
    sort: blockJsonSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(10_000).optional(),
  }),
  PICK_RECORD: z.object({
    objectName,
    recordIds: z.array(recordId).min(1).max(100),
    selectionMode: z.enum(["RANDOM", "ROUND_ROBIN", "LOAD_BALANCED"]),
    loadField: z.string().max(100).optional(),
    loadRelation: z.object({ objectName, field: z.string().max(100) }).optional(),
  }),
  FILTER: z.object({ condition: conditionSchema }),
  IF_ELSE: z.object({
    branches: z
      .array(z.object({ id, condition: conditionSchema.optional() }))
      .min(1)
      .max(20),
  }),
  ITERATOR: z.object({
    items: z.union([z.array(blockJsonSchema).max(10_000), z.string().max(100_000)]),
    shouldContinueOnIterationFailure: z.boolean().optional(),
  }),
  DELAY: z.union([
    z.object({ mode: z.literal("duration"), seconds: z.number().int().min(1).max(31_536_000) }),
    z.object({ mode: z.literal("date"), until: z.iso.datetime({ offset: true }) }),
  ]),
  FORM: z.object({
    fields: z.array(formField).min(1).max(40),
    instructions: z.string().max(10_000).optional(),
    responderId: recordId.optional(),
  }),
  WAIT_FOR_EVENT: z.object({
    eventName: z
      .string()
      .regex(/^(deal|lead|person|organization|activity)\.(created|updated|deleted)$/),
    recordId: recordId.optional(),
    updatedFields: z.array(z.string().max(100)).max(40).optional(),
    timeoutSeconds: z.number().int().min(1).max(31_536_000).optional(),
  }),
  CODE: z.object({
    sourceCode: z.string().min(1).max(50_000),
    inputs: fields.optional(),
    outputSchema: fields.optional(),
  }),
  LOGIC_FUNCTION: z.object({
    functionId: recordId,
    inputs: fields.optional(),
    outputSchema: fields.optional(),
  }),
  HTTP_REQUEST: z.object({
    url: z.url().max(2000),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    headers: z.record(z.string(), z.string()).optional(),
    body: blockJsonSchema.optional(),
    responseSchema: fields.optional(),
  }),
  SEND_EMAIL: z.object({
    accountId: recordId,
    to: z.array(z.email()).min(1).max(100),
    subject: z.string().max(1000),
    bodyHtml: z.string().max(100_000),
    cc: z.array(z.email()).max(100).optional(),
    bcc: z.array(z.email()).max(100).optional(),
    attachments: z
      .array(z.object({ fileId: recordId }))
      .max(30)
      .optional(),
    threadId: recordId.optional(),
    signatureId: recordId.optional(),
  }),
  DRAFT_EMAIL: z.object({
    accountId: recordId,
    to: z.array(z.email()).max(100).optional(),
    subject: z.string().max(1000),
    bodyHtml: z.string().max(100_000),
    cc: z.array(z.email()).max(100).optional(),
    bcc: z.array(z.email()).max(100).optional(),
    attachments: z
      .array(z.object({ fileId: recordId }))
      .max(30)
      .optional(),
    threadId: recordId.optional(),
    signatureId: recordId.optional(),
  }),
  SEND_CHAT_MESSAGE: z.object({
    recipientId: recordId,
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(10_000),
    requireApproval: z.boolean().optional(),
  }),
  CREATE_CALENDAR_EVENT: z.object({
    title: z.string().min(1).max(300),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    allDay: z.boolean().optional(),
    timeZone: z.string().max(100).optional(),
    attendeeEmails: z.array(z.email()).max(100).optional(),
    sendInvitations: z.boolean().optional(),
    createConference: z.boolean().optional(),
    assigneeId: recordId.optional(),
    typeId: recordId.optional(),
  }),
  AI_AGENT: z.object({
    prompt: z.string().min(1).max(50_000),
    providerModel: z.string().max(200).optional(),
    instructions: z.string().max(50_000).optional(),
    responseSchema: fields.optional(),
  }),
  CLASSIFY: z.object({
    input: z.string().min(1).max(50_000),
    questions: z
      .array(
        z.object({
          key: id,
          type: z.enum(["boolean", "choice", "score"]),
          instructions: z.string().max(10_000).optional(),
          choices: z.array(z.string().min(1).max(200)).max(50).optional(),
          min: z.number().finite().optional(),
          max: z.number().finite().optional(),
        }),
      )
      .min(1)
      .max(40),
  }),
};
export const resolvedBlockConfigSchemas = configs;
export function validateResolvedBlockConfig(type: keyof typeof configs, config: unknown) {
  return configs[type].safeParse(config);
}
