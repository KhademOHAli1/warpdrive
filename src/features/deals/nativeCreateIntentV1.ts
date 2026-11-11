import { z } from "zod";

// Persisted native protocol: keep this decoder when shared creation rules or V2 evolve.
// Mutable currency/custom-field/catalog admission belongs only on a receipt miss.
const uuidV1 = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const channelsV1 = [
  "outbound",
  "inbound",
  "referral",
  "web_form",
  "chatbot",
  "campaign",
  "social",
  "event",
  "advertising",
  "other",
] as const;

export function exactNativeMoneyV1(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new TypeError("Invalid amount");
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0))
    throw new TypeError("Invalid amount");
  const raw = String(value);
  if (!/^\d{1,14}(?:\.\d{1,4})?$/.test(raw)) throw new TypeError("Invalid amount");
  const [integer = "0", fraction = ""] = raw.split(".");
  return `${BigInt(integer).toString()}.${fraction.padEnd(4, "0")}`;
}

// Golden canonical bytes use JS code-unit key order, ordered arrays, null, and -0 -> 0.
// Reject non-JSON values rather than silently dropping keys or rounding through a clone.
export function canonicalNativeJsonV1(value: unknown): string {
  const ancestors = new Set<object>();
  let entries = 0;
  function encode(current: unknown, depth: number): string {
    if (depth > 20 || ++entries > 5000) throw new TypeError("Intent is too complex");
    if (current === null) return "null";
    if (typeof current === "string" || typeof current === "boolean") return JSON.stringify(current);
    if (typeof current === "number" && Number.isFinite(current)) return JSON.stringify(current);
    if (typeof current !== "object") throw new TypeError("Only finite JSON is supported");
    if (Object.getOwnPropertySymbols(current).length > 0)
      throw new TypeError("Symbol keys are unsupported");
    if (ancestors.has(current)) throw new TypeError("Cyclic intent");
    if (
      !Array.isArray(current) &&
      Object.getPrototypeOf(current) !== Object.prototype &&
      Object.getPrototypeOf(current) !== null
    )
      throw new TypeError("Only JSON objects are supported");
    ancestors.add(current);
    const result = Array.isArray(current)
      ? `[${Array.from(current, (item) => encode(item, depth + 1)).join(",")}]`
      : `{${Object.keys(current)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${encode((current as Record<string, unknown>)[key], depth + 1)}`,
          )
          .join(",")}}`;
    ancestors.delete(current);
    return result;
  }
  const bytes = encode(value, 0);
  if (bytes.length > 100_000) throw new TypeError("Intent is too large");
  return bytes;
}

const moneyV1 = z
  .unknown()
  .default(null)
  .transform((value, context) => {
    try {
      return exactNativeMoneyV1(value);
    } catch {
      context.addIssue({ code: "custom", message: "Invalid exact amount" });
      return z.NEVER;
    }
  });
const customFieldsV1 = z
  .unknown()
  .default({})
  .transform((value, context): Record<string, unknown> => {
    try {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        throw new TypeError("Object required");
      return JSON.parse(canonicalNativeJsonV1(value)) as Record<string, unknown>;
    } catch {
      context.addIssue({ code: "custom", message: "Finite JSON custom fields required" });
      return z.NEVER;
    }
  });
const labelsV1 = z
  .array(z.string().trim().min(1).max(40))
  .default([])
  .transform((names) => {
    const seen = new Set<string>();
    return names.filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  })
  .pipe(z.array(z.string()).max(24));

const intentV1 = z
  .strictObject({
    title: z.string().trim().min(1).max(255),
    value: moneyV1,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    pipelineId: uuidV1,
    stageId: uuidV1,
    personId: uuidV1.nullable().default(null),
    orgId: uuidV1.nullable().default(null),
    expectedCloseDate: z.string().date().nullable().default(null),
    labels: labelsV1,
    sourceChannel: z.enum(channelsV1).nullable().default(null),
    sourceChannelId: z.string().max(255).nullable().default(null),
    newsletterExposureId: uuidV1.optional(),
    ownerId: uuidV1.optional(),
    visibilityGroupId: uuidV1.optional(),
    customFields: customFieldsV1,
  })
  .transform(({ currency, ownerId, visibilityGroupId, newsletterExposureId, ...deal }) => ({
    ...deal,
    ...(currency === undefined ? {} : { currency }),
    ...(ownerId === undefined ? {} : { ownerId }),
    ...(visibilityGroupId === undefined ? {} : { visibilityGroupId }),
    ...(newsletterExposureId === undefined ? {} : { newsletterExposureId }),
  }));
export const nativeDealCreateEnvelopeV1 = z.strictObject({
  protocolVersion: z.literal(1),
  expectedActorId: uuidV1,
  creationOperationId: uuidV1,
  deal: intentV1,
});
export type NativeDealCreateEnvelopeV1 = z.infer<typeof nativeDealCreateEnvelopeV1>;
export type NativeDealIntentV1 = NativeDealCreateEnvelopeV1["deal"];

export function nativeDealFingerprintBytesV1(envelope: NativeDealCreateEnvelopeV1): string {
  return canonicalNativeJsonV1({
    domain: "warpdrive.native.deal-create",
    protocolVersion: 1,
    actorId: envelope.expectedActorId,
    operationId: envelope.creationOperationId,
    deal: envelope.deal,
  });
}
