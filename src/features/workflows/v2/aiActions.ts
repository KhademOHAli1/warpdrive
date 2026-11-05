import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { workflowV2RuntimeSettings } from "@/db/schema/workflowV2Functions";
import type { BlockJson, BlockOutput } from "@/features/blocks/contracts";
import { decryptToken } from "@/features/email/crypto";
import { err, ok, type Result } from "@/types/result";
import {
  safeWorkflowHttpRequest,
  type WorkflowHttpResponse,
  type WorkflowTransportError,
} from "./httpTransport";
import { isBlockJson, matchesResponseSchema, validResponseSchema } from "./responseSchema";

type AiType = "AI_AGENT" | "CLASSIFY";
function object(value: BlockJson | undefined): value is BlockOutput {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function questionSchema(question: BlockOutput): BlockOutput | null {
  if (question.type === "boolean") return { type: "boolean" };
  if (
    question.type === "choice" &&
    Array.isArray(question.choices) &&
    question.choices.length > 0 &&
    question.choices.every((choice) => typeof choice === "string")
  )
    return { type: "string", enum: question.choices };
  if (question.type !== "score") return null;
  const minimum = typeof question.min === "number" ? question.min : 0;
  const maximum = typeof question.max === "number" ? question.max : 10;
  return minimum <= maximum ? { type: "number", minimum, maximum } : null;
}
export function classificationSchema(questions: BlockJson | undefined): BlockJson | null {
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 40) return null;
  const properties: BlockOutput = {};
  for (const question of questions) {
    if (!object(question) || typeof question.key !== "string" || question.key in properties)
      return null;
    const schema = questionSchema(question);
    if (schema === null) return null;
    properties[question.key] = schema;
  }
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
const providerFailure = () => err({ id: "E_WORKFLOW_AI_RESPONSE", outcome: "unknown" as const });
function parseAiResponse(
  response: WorkflowHttpResponse,
  schema: BlockJson | undefined,
): Result<BlockOutput, WorkflowTransportError> {
  if (response.status < 200 || response.status >= 300 || !object(response.body))
    return providerFailure();
  const choices = response.body.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = object(first) ? first.message : undefined;
  const content = object(message) ? message.content : undefined;
  if (typeof content !== "string") return providerFailure();
  if (schema === undefined) return ok({ text: content });
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return providerFailure();
  }
  if (!isBlockJson(parsed) || !matchesResponseSchema(schema, parsed))
    return err({ id: "E_WORKFLOW_BLOCK_OUTPUT", outcome: "unknown" });
  return ok(object(parsed) ? parsed : { value: parsed });
}
function aiRequest(
  type: AiType,
  config: BlockOutput,
  model: string,
  schema: BlockJson | undefined,
): BlockOutput {
  const classify = type === "CLASSIFY";
  const instructions = classify
    ? `Classify the supplied input. Return only the required JSON object. Questions: ${JSON.stringify(config.questions)}`
    : typeof config.instructions === "string"
      ? config.instructions
      : "";
  const prompt = classify ? config.input : config.prompt;
  return {
    model,
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: typeof prompt === "string" ? prompt : "" },
    ],
    ...(schema !== undefined
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: "workflow_output", strict: false, schema },
          },
        }
      : {}),
  };
}
export async function executeWorkflowAi(
  db: Db,
  type: AiType,
  config: BlockOutput,
  signal: AbortSignal,
): Promise<Result<BlockOutput, WorkflowTransportError>> {
  const [runtime] = await db
    .select()
    .from(workflowV2RuntimeSettings)
    .where(eq(workflowV2RuntimeSettings.id, true));
  if (runtime?.aiApiKey === null || runtime?.aiApiKey === undefined || runtime.aiBaseUrl === null)
    return err({ id: "E_WORKFLOW_AI_SETUP" });
  const key = decryptToken(runtime.aiApiKey);
  if (!key.ok) return err({ id: "E_WORKFLOW_AI_SETUP" });
  const model =
    typeof config.providerModel === "string" && config.providerModel !== ""
      ? config.providerModel
      : runtime.aiDefaultModel;
  if (model === null || !runtime.aiModels.includes(model))
    return err({ id: "E_WORKFLOW_AI_MODEL" });
  const schema =
    type === "CLASSIFY" ? classificationSchema(config.questions) : config.responseSchema;
  if (schema !== undefined && (schema === null || !validResponseSchema(schema)))
    return err({ id: "E_WORKFLOW_AI_SCHEMA" });
  const response = await safeWorkflowHttpRequest(
    {
      url: `${runtime.aiBaseUrl.replace(/\/$/u, "")}/chat/completions`,
      method: "POST",
      headers: { authorization: `Bearer ${key.value}`, "content-type": "application/json" },
      body: aiRequest(type, config, model, schema),
    },
    signal,
    { policy: { internalEndpoints: runtime.internalEndpoints } },
  );
  return response.ok ? parseAiResponse(response.value, schema) : response;
}
