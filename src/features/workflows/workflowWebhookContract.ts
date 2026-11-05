import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

export const workflowWebhookLimits = {
  bodyBytes: 1024,
  clockSkewMs: 5 * 60 * 1000,
} as const;

// No secret, caller identity, or execution mode is part of draft configuration.
export const workflowWebhookTriggerConfigSchema = z.strictObject({
  httpMethod: z.enum(["GET", "POST"]),
  authentication: z.literal("HMAC_SHA256"),
});

const uuid = z
  .uuid()
  .length(36)
  .transform((value) => value.toLowerCase());

export const workflowWebhookPublicationSchema = z.strictObject({
  workflowId: uuid,
  versionId: uuid,
});
export type WorkflowWebhookPublication = z.infer<typeof workflowWebhookPublicationSchema>;

export function workflowWebhookEndpointPath(publication: WorkflowWebhookPublication): string {
  return `/api/workflows/${publication.workflowId}/webhook/${publication.versionId}`;
}

export const workflowWebhookPayloadSchema = z.strictObject({
  eventId: uuid,
  recordId: uuid,
});
export type WorkflowWebhookPayload = z.infer<typeof workflowWebhookPayloadSchema>;

export const workflowWebhookLaunchPayload = z.discriminatedUnion("httpMethod", [
  z.strictObject({ scope: z.literal("webhook"), httpMethod: z.literal("GET"), eventId: uuid }),
  workflowWebhookPayloadSchema.extend({
    scope: z.literal("webhook"),
    httpMethod: z.literal("POST"),
  }),
]);
export type WorkflowWebhookLaunchPayload = z.infer<typeof workflowWebhookLaunchPayload>;

interface WebhookTriggerDefinition {
  nodes: readonly { id: string; type: string; version: number; config: unknown }[];
}

export function readWorkflowWebhookTrigger(definition: WebhookTriggerDefinition) {
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  const trigger = triggers[0];
  if (triggers.length !== 1 || trigger?.type !== "trigger.webhook" || trigger.version !== 1)
    return null;
  const config = workflowWebhookTriggerConfigSchema.safeParse(trigger.config);
  return config.success ? { id: trigger.id, config: config.data } : null;
}

export function readWorkflowWebhookLaunch(
  definition: WebhookTriggerDefinition,
  raw: unknown,
): WorkflowWebhookLaunchPayload | null {
  const trigger = readWorkflowWebhookTrigger(definition);
  const parsed = workflowWebhookLaunchPayload.safeParse(raw);
  return parsed.success && trigger?.config.httpMethod === parsed.data.httpMethod
    ? parsed.data
    : null;
}

export function projectWorkflowWebhookLaunch(
  launch: WorkflowWebhookLaunchPayload,
): Record<string, string> {
  return launch.httpMethod === "POST" ? { recordId: launch.recordId } : {};
}

export function parseWorkflowWebhookQuery(raw: string): string | null {
  if (raw.length !== 44 || !raw.startsWith("eventId=")) return null;
  const eventId = raw.slice(8);
  const parsed = uuid.safeParse(eventId);
  return parsed.success && parsed.data === eventId ? parsed.data : null;
}

// This flat wire format accepts either key order and JSON whitespace. Parsing
// the two literal field names directly rejects duplicate keys, including escaped
// aliases that JSON.parse would otherwise collapse before schema validation.
const payloadShape =
  /^[\t\n\r ]*\{[\t\n\r ]*"(eventId|recordId)"[\t\n\r ]*:[\t\n\r ]*"([0-9A-Fa-f-]{36})"[\t\n\r ]*,[\t\n\r ]*"(eventId|recordId)"[\t\n\r ]*:[\t\n\r ]*"([0-9A-Fa-f-]{36})"[\t\n\r ]*\}[\t\n\r ]*$/u;
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function parseWorkflowWebhookPayload(
  bytes: Uint8Array,
): Result<WorkflowWebhookPayload, "invalid-payload"> {
  if (bytes.byteLength === 0 || bytes.byteLength > workflowWebhookLimits.bodyBytes)
    return err("invalid-payload");

  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return err("invalid-payload");
  }
  const match = payloadShape.exec(text);
  if (match === null || match[0].length !== text.length || match[1] === match[3])
    return err("invalid-payload");
  const parsed = workflowWebhookPayloadSchema.safeParse(
    match[1] === "eventId"
      ? { eventId: match[2], recordId: match[4] }
      : { eventId: match[4], recordId: match[2] },
  );
  return parsed.success ? ok(parsed.data) : err("invalid-payload");
}
