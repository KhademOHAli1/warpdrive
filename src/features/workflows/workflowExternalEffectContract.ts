import { z } from "zod";
import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";

export const workflowExternalEffectStates = ["started", "complete", "not_sent", "unknown"] as const;
export const workflowExternalEffectAbandonAfterMs = 120_000;
export const workflowExternalEffectMaxOutputBytes = 128 * 1_024;
const maxOutputFields = 32;
const maxTextBytes = 4_096;
const jsonbExpansionPerField = 512;

export const workflowExternalEffectIdentity = z.strictObject({
  runId: z.uuid(),
  nodeId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  iterationIndex: z.number().int().min(-1).max(99),
  kind: z
    .string()
    .max(64)
    .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
});
export type WorkflowExternalEffectIdentity = z.infer<typeof workflowExternalEffectIdentity>;
export const workflowExternalEffectDigest = z.string().regex(/^[0-9a-f]{64}$/);

const knownErrors: ReadonlySet<string> = new Set(Object.values(ERROR_IDS));
export const workflowExternalEffectErrorId = z.custom<ErrorId>(
  (raw) => typeof raw === "string" && knownErrors.has(raw),
);

const rawOutputKeys = new Set(["body", "headers", "rawresponse", "credentials"]);
const outputKey = z
  .string()
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/)
  .refine(
    (value) =>
      !rawOutputKeys.has(value.toLowerCase()) && value !== "constructor" && value !== "prototype",
  );
const outputValue = z.union([
  z
    .string()
    .max(maxTextBytes)
    .refine(
      (value) =>
        Buffer.byteLength(value) <= maxTextBytes &&
        !value.includes("\0") &&
        !/[\uD800-\uDFFF]/u.test(value),
    ),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

// Provider adapters must project the documented typed output before settling.
// Do not pass raw response objects, headers, delivery diagnostics, or secrets.
const output = z.preprocess(
  (raw) =>
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw).length <= maxOutputFields
      ? raw
      : null,
  z.record(outputKey, outputValue).refine(
    (data) =>
      // JSONB renders tiny exponential numbers as expanded decimals and adds spacing.
      Buffer.byteLength(JSON.stringify(data)) + maxOutputFields * jsonbExpansionPerField <=
      workflowExternalEffectMaxOutputBytes,
  ),
);
export type WorkflowExternalEffectOutput = z.infer<typeof output>;

export const workflowExternalEffectCompletion = z.union([
  z.strictObject({ state: z.literal("complete"), output }),
  z.strictObject({ state: z.literal("complete"), errorId: workflowExternalEffectErrorId }),
  z.strictObject({
    state: z.enum(["not_sent", "unknown"]),
    errorId: workflowExternalEffectErrorId,
  }),
]);
export type WorkflowExternalEffectCompletion = z.infer<typeof workflowExternalEffectCompletion>;
