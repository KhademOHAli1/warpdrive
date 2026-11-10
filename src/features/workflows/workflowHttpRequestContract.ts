import { z } from "zod";
import type { MappingTarget } from "./mappingTypes";
import { bindingSchema } from "./schemas";

// Compared with Twenty's general-purpose HTTP tool, execution here is grant-bound.
// It supports UTF-8 text or a flat JSON scalar body and projects declared scalar
// fields only. Credentials belong to operator policy, and previews never dispatch.
export const workflowHttpMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type WorkflowHttpMethod = (typeof workflowHttpMethods)[number];
export const workflowHttpRequestLimits = Object.freeze({
  url: 2_048,
  headers: 16,
  headerValue: 2_048,
  headerBytes: 8 * 1_024,
  bodyBytes: 64 * 1_024,
  fields: 24,
  outputText: 4_096,
});

const reservedHeaders = new Set([
  "accept-encoding",
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "expect",
  "forwarded",
  "host",
  "idempotency-key",
  "keep-alive",
  "origin",
  "referer",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "user-agent",
  "via",
  "x-http-method",
  "x-http-method-override",
  "x-method-override",
  "x-original-url",
  "x-rewrite-url",
]);
const credentials = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "api-key"]);

export function isWorkflowHttpHeaderName(name: string, operator = false): boolean {
  const lower = name.toLowerCase();
  return (
    /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(name) &&
    !reservedHeaders.has(lower) &&
    !/^(?:proxy-|sec-|x-forwarded-)/.test(lower) &&
    (operator || !credentials.has(lower))
  );
}

export function isWorkflowHttpHeaderValue(value: string): boolean {
  return value.length <= workflowHttpRequestLimits.headerValue && /^[\x20-\x7e]*$/.test(value);
}

export function workflowHttpsUrl(raw: unknown): URL | undefined {
  if (
    typeof raw !== "string" ||
    raw.length > workflowHttpRequestLimits.url ||
    !/^https:\/\/[^\\\s#]+$/i.test(raw) ||
    !URL.canParse(raw)
  )
    return undefined;
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname === "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  )
    return undefined;
  return parsed;
}

function stringBinding(valid: (value: string) => boolean) {
  return bindingSchema.refine(
    (value) =>
      value.kind === "reference" ||
      (typeof value.value === "string" && value.literalType === undefined && valid(value.value)),
  );
}

const header = z.strictObject({
  name: z
    .string()
    .refine((name) => isWorkflowHttpHeaderName(name))
    .transform((name) => name.toLowerCase()),
  value: stringBinding(isWorkflowHttpHeaderValue),
});
const fieldName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  .refine((name) => name !== "constructor" && name !== "prototype");
const jsonField = z.strictObject({ name: fieldName, value: bindingSchema });
const responseField = z.strictObject({
  name: fieldName,
  type: z.enum(["text", "number", "boolean"]),
  nullable: z.boolean().optional(),
});

function uniqueNames(fields: readonly { name: string }[]): boolean {
  return new Set(fields.map(({ name }) => name)).size === fields.length;
}

function boundedArray(raw: unknown, max: number): boolean {
  return raw === undefined || (Array.isArray(raw) && raw.length <= max);
}

export function boundedWorkflowHttpRequestConfig(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const body: unknown = Reflect.get(raw, "body");
  return (
    boundedArray(Reflect.get(raw, "headers"), workflowHttpRequestLimits.headers) &&
    boundedArray(Reflect.get(raw, "response"), workflowHttpRequestLimits.fields) &&
    (body === undefined ||
      (body !== null &&
        typeof body === "object" &&
        boundedArray(Reflect.get(body, "fields"), workflowHttpRequestLimits.fields)))
  );
}

export const workflowHttpRequestConfig = z.preprocess(
  (raw) => (boundedWorkflowHttpRequestConfig(raw) ? raw : null),
  z
    .strictObject({
      url: stringBinding((value) => workflowHttpsUrl(value) !== undefined),
      method: z.enum(workflowHttpMethods),
      headers: z
        .array(header)
        .max(workflowHttpRequestLimits.headers)
        .refine(uniqueNames)
        .optional(),
      body: z
        .discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("text"),
            value: stringBinding((value) => !value.includes("\0")),
          }),
          z.strictObject({
            kind: z.literal("json"),
            fields: z.array(jsonField).max(workflowHttpRequestLimits.fields).refine(uniqueNames),
          }),
        ])
        .optional(),
      response: z
        .array(responseField)
        .max(workflowHttpRequestLimits.fields)
        .refine(uniqueNames)
        .optional(),
    })
    .refine(({ method, body }) => method !== "GET" || body === undefined),
);

export type WorkflowHttpRequestConfig = z.infer<typeof workflowHttpRequestConfig>;
export type WorkflowHttpResponseField = z.infer<typeof responseField>;

function fieldIndex(value: string | undefined, size: number): boolean {
  return value !== undefined && /^(?:0|[1-9]\d?)$/.test(value) && Number(value) < size;
}

export function workflowHttpRequestTarget(
  nodeId: string,
  path: readonly string[],
): MappingTarget | undefined {
  const [root, indexOrValue, name, entryValue] = path;
  const text =
    (path.length === 1 && root === "url") ||
    (path.length === 2 && root === "body" && indexOrValue === "value") ||
    (path.length === 3 &&
      root === "headers" &&
      name === "value" &&
      fieldIndex(indexOrValue, workflowHttpRequestLimits.headers));
  const json =
    path.length === 4 &&
    root === "body" &&
    indexOrValue === "fields" &&
    entryValue === "value" &&
    fieldIndex(name, workflowHttpRequestLimits.fields);
  return text || json
    ? {
        nodeId,
        path,
        contract: { kind: text ? "text" : "scalar", nullable: json },
        required: true,
        mode: "binding",
      }
    : undefined;
}
