import { z } from "zod";

export const workflowAiLimits = Object.freeze({
  inputBytes: 8_192,
  requestBytes: 16_384,
  responseBytes: 32_768,
  responseTextBytes: 4_096,
  fields: 8,
  questions: 8,
  criteria: 8,
  maxInputTokens: 4_096,
  maxOutputTokens: 768,
  deadlineMs: 10_000,
});

export const workflowAiActionKinds = ["ai.agent", "ai.classify"] as const;
const utf8 = new TextEncoder();

function boundedText(maxBytes: number) {
  return z
    .string()
    .max(maxBytes)
    .refine(
      (value) =>
        value.trim() !== "" &&
        !value.includes("\0") &&
        !/[\uD800-\uDFFF]/u.test(value) &&
        utf8.encode(value).byteLength <= maxBytes,
    );
}

const inputText = boundedText(workflowAiLimits.inputBytes);
export const workflowAiResponseText = boundedText(workflowAiLimits.responseTextBytes);
const fieldName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
  .refine((value) => value !== "constructor" && value !== "prototype");

function boundedList<T extends z.ZodType>(item: T, min: number, max: number) {
  return z.preprocess(
    (raw) => (Array.isArray(raw) && raw.length <= max ? raw : null),
    z.array(item).min(min).max(max).readonly(),
  );
}

function uniqueNames(values: readonly { name: string }[]): boolean {
  return new Set(values.map(({ name }) => name)).size === values.length;
}

const responseField = z
  .strictObject({ name: fieldName, type: z.enum(["text", "number", "boolean"]) })
  .readonly();
const agentResponse = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("text") }),
    z.strictObject({
      kind: z.literal("json"),
      fields: boundedList(responseField, 1, workflowAiLimits.fields).refine(uniqueNames),
    }),
  ])
  .readonly();

// This contract represents a tool-free prompt with one response. Twenty's saved
// agents, conversations, permissions, and human callbacks have separate lifecycles.
export const workflowAiAgentConfig = z
  .strictObject({ prompt: inputText, response: agentResponse })
  .readonly();
export type WorkflowAiAgentConfig = z.infer<typeof workflowAiAgentConfig>;

const questionBase = { name: fieldName, question: boundedText(512) };
const criteria = boundedList(boundedText(128), 2, workflowAiLimits.criteria).refine(
  (values) => new Set(values).size === values.length,
);
const question = z
  .discriminatedUnion("kind", [
    z.strictObject({ ...questionBase, kind: z.literal("boolean") }),
    z.strictObject({ ...questionBase, kind: z.literal("score"), criteria }),
    z.strictObject({ ...questionBase, kind: z.literal("choice"), criteria }),
  ])
  .readonly();
export type WorkflowAiQuestion = z.infer<typeof question>;

export const workflowAiClassifyConfig = z
  .strictObject({
    state: inputText,
    questions: boundedList(question, 1, workflowAiLimits.questions).refine(uniqueNames),
  })
  .readonly();
export type WorkflowAiClassifyConfig = z.infer<typeof workflowAiClassifyConfig>;

export const workflowAiInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ai.agent"), config: workflowAiAgentConfig }),
  z.strictObject({ kind: z.literal("ai.classify"), config: workflowAiClassifyConfig }),
]);
export type WorkflowAiInput = z.infer<typeof workflowAiInput>;

export function workflowAiOutputFields(input: WorkflowAiInput): ReadonlyArray<{
  path: readonly string[];
  kind: "text" | "number" | "boolean";
}> {
  if (input.kind === "ai.classify") {
    // Boolean evaluations return the probability of true, as in Twenty's evaluator.
    return input.config.questions.map(({ kind, name }) => ({
      path: ["answers", name],
      kind: kind === "choice" ? "text" : "number",
    }));
  }
  if (input.config.response.kind === "text") return [{ path: ["response"], kind: "text" }];
  return input.config.response.fields.map(({ name, type }) => ({
    path: ["response", name],
    kind: type,
  }));
}
