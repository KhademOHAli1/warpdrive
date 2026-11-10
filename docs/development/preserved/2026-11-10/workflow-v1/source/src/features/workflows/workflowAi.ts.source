import { createHash } from "node:crypto";
import { z } from "zod";
import { ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import {
  type WorkflowAiAgentConfig,
  type WorkflowAiInput,
  type WorkflowAiQuestion,
  workflowAiInput,
  workflowAiLimits,
  workflowAiResponseText,
} from "./workflowAiContract";
import {
  consumeWorkflowExternalEffectDispatch,
  isFreshWorkflowExternalEffectDispatch,
} from "./workflowExternalEffect";
import {
  type WorkflowExternalEffectCompletion,
  type WorkflowExternalEffectIdentity,
  type WorkflowExternalEffectOutput,
  workflowExternalEffectCompletion,
  workflowExternalEffectIdentity,
} from "./workflowExternalEffectContract";

const capability = z.enum([
  "agent.text",
  "agent.json",
  "classify.boolean",
  "classify.score",
  "classify.choice",
]);
const profile = z
  .strictObject({
    id: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    generation: z.number().int().positive(),
    capabilities: z.array(capability).min(1).max(5).readonly(),
  })
  .readonly();

export type WorkflowAiGatewayRequest = Readonly<
  WorkflowAiInput & { maxInputTokens: number; maxOutputTokens: number }
>;

export interface WorkflowAiGateway {
  readonly profile: z.infer<typeof profile>;
  // The operator gateway enforces the token budgets before sending, supports
  // only the declared modes, makes one tool-free call without retries, and
  // bounds the normalized UTF-8 JSON body while reading. Boolean capability
  // requires a calibrated probability result from an evaluation provider.
  invoke(request: WorkflowAiGatewayRequest, signal: AbortSignal): Promise<WorkflowAiGatewayReply>;
}

const reply = z.strictObject({
  body: z
    .instanceof(Uint8Array)
    .refine((bytes) => bytes.byteLength <= workflowAiLimits.responseBytes),
  inputTokens: z.number().int().min(1).max(workflowAiLimits.maxInputTokens),
  outputTokens: z.number().int().min(1).max(workflowAiLimits.maxOutputTokens),
});
export type WorkflowAiGatewayReply = z.infer<typeof reply>;

export interface WorkflowAiPlan {
  readonly identity: Readonly<WorkflowExternalEffectIdentity>;
  readonly profileId: string;
  readonly profileGeneration: number;
  readonly request: WorkflowAiGatewayRequest;
  readonly requestDigest: string;
}

const preparedPlans = new WeakSet<WorkflowAiPlan>();

function supports(
  input: WorkflowAiInput,
  capabilities: z.infer<typeof profile>["capabilities"],
): boolean {
  return input.kind === "ai.agent"
    ? capabilities.includes(`agent.${input.config.response.kind}`)
    : input.config.questions.every(({ kind }) => capabilities.includes(`classify.${kind}`));
}

export function prepareWorkflowAi(
  raw: { identity: unknown; config: unknown },
  gateway: WorkflowAiGateway | undefined,
): Result<{ value: WorkflowAiPlan; requestDigest: string }, ErrorId> {
  const identity = workflowExternalEffectIdentity.safeParse(raw.identity);
  if (!identity.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const input = workflowAiInput.safeParse({ kind: identity.data.kind, config: raw.config });
  if (!input.success) return err(ERROR_IDS.WORKFLOW_INVALID);
  const current = profile.safeParse(gateway?.profile);
  if (!current.success || !supports(input.data, current.data.capabilities))
    return err(ERROR_IDS.WORKFLOW_NOT_READY);

  const request = Object.freeze({
    ...input.data,
    maxInputTokens: workflowAiLimits.maxInputTokens,
    maxOutputTokens: workflowAiLimits.maxOutputTokens,
  });
  const serialized = JSON.stringify(request);
  if (Buffer.byteLength(serialized) > workflowAiLimits.requestBytes)
    return err(ERROR_IDS.WORKFLOW_INVALID);
  const { runId, nodeId, iterationIndex } = identity.data;
  const { id, generation } = current.data;
  const requestDigest = createHash("sha256")
    .update(
      JSON.stringify([
        "warpdrive.workflow.ai.v1",
        runId,
        nodeId,
        iterationIndex,
        id,
        generation,
        serialized,
      ]),
    )
    .digest("hex");
  const value = Object.freeze({
    identity: Object.freeze(identity.data),
    profileId: id,
    profileGeneration: generation,
    request,
    requestDigest,
  });
  preparedPlans.add(value);
  return ok({ value, requestDigest });
}

const scalarField = {
  text: workflowAiResponseText,
  number: z.number().finite(),
  boolean: z.boolean(),
};
const boundedFields = z.custom<Record<string, unknown>>(
  (raw) =>
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    Object.keys(raw).length <= workflowAiLimits.fields,
);
const textReply = z.strictObject({ text: workflowAiResponseText });
const fieldsReply = z.strictObject({ values: boundedFields });
const answersReply = z.strictObject({ answers: boundedFields });
const evaluation = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("boolean"), probability: z.number().min(0).max(1) }),
  z.strictObject({ type: z.literal("score"), score: z.number().nonnegative() }),
  z.strictObject({ type: z.literal("choice"), choice: z.string() }),
]);

function projectAgent(
  response: WorkflowAiAgentConfig["response"],
  raw: unknown,
): WorkflowExternalEffectOutput | undefined {
  if (response.kind === "text") {
    const parsed = textReply.safeParse(raw);
    return parsed.success ? { response: parsed.data.text } : undefined;
  }
  const parsed = fieldsReply.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data.values).length !== response.fields.length)
    return undefined;
  const output: WorkflowExternalEffectOutput = {};
  for (const { name, type } of response.fields) {
    if (!Object.hasOwn(parsed.data.values, name)) return undefined;
    const field = scalarField[type].safeParse(parsed.data.values[name]);
    if (!field.success) return undefined;
    output[`response.${name}`] = field.data;
  }
  return output;
}

function projectAnswer(question: WorkflowAiQuestion, raw: unknown): number | string | undefined {
  const answer = evaluation.safeParse(raw);
  if (!answer.success) return undefined;
  const value = answer.data;
  if (question.kind === "boolean" && value.type === "boolean") return value.probability;
  if (
    question.kind === "score" &&
    value.type === "score" &&
    value.score <= question.criteria.length - 1
  )
    return value.score;
  if (
    question.kind === "choice" &&
    value.type === "choice" &&
    question.criteria.includes(value.choice)
  )
    return value.choice;
  return undefined;
}

function projectClassify(
  questions: readonly WorkflowAiQuestion[],
  raw: unknown,
): WorkflowExternalEffectOutput | undefined {
  const parsed = answersReply.safeParse(raw);
  if (!parsed.success || Object.keys(parsed.data.answers).length !== questions.length)
    return undefined;
  const output: WorkflowExternalEffectOutput = {};
  for (const question of questions) {
    if (!Object.hasOwn(parsed.data.answers, question.name)) return undefined;
    const answer = projectAnswer(question, parsed.data.answers[question.name]);
    if (answer === undefined) return undefined;
    output[`answers.${question.name}`] = answer;
  }
  return output;
}

function invalidReply(): WorkflowExternalEffectCompletion {
  return { state: "complete", errorId: ERROR_IDS.WORKFLOW_INVALID };
}

function projectReply(input: WorkflowAiInput, raw: unknown): WorkflowExternalEffectCompletion {
  const parsed = reply.safeParse(raw);
  if (!parsed.success) return invalidReply();
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(parsed.data.body));
  } catch {
    return invalidReply();
  }
  const output =
    input.kind === "ai.agent"
      ? projectAgent(input.config.response, decoded)
      : projectClassify(input.config.questions, decoded);
  const completion = workflowExternalEffectCompletion.safeParse({ state: "complete", output });
  return completion.success ? completion.data : invalidReply();
}

async function invokeOnce(
  gateway: WorkflowAiGateway,
  request: WorkflowAiGatewayRequest,
  signal: AbortSignal,
): Promise<WorkflowExternalEffectCompletion> {
  const deadline = new AbortController();
  const combined = AbortSignal.any([signal, deadline.signal]);
  const timer = setTimeout(() => deadline.abort(), workflowAiLimits.deadlineMs);
  const interrupted = Symbol("interrupted AI request");
  let onAbort: (() => void) | undefined;
  try {
    const abort = new Promise<typeof interrupted>((resolve) => {
      onAbort = () => resolve(interrupted);
      combined.addEventListener("abort", onAbort, { once: true });
    });
    const raw = await Promise.race([abort, gateway.invoke(request, combined)]);
    if (combined.aborted || raw === interrupted)
      return { state: "unknown", errorId: ERROR_IDS.WORKFLOW_NOT_READY };
    return projectReply(request, raw);
  } catch {
    return { state: "unknown", errorId: ERROR_IDS.WORKFLOW_NOT_READY };
  } finally {
    clearTimeout(timer);
    if (onAbort !== undefined) combined.removeEventListener("abort", onAbort);
  }
}

export async function dispatchWorkflowAi(
  plan: WorkflowAiPlan,
  dispatch: unknown,
  gateway: WorkflowAiGateway | undefined,
  signal: AbortSignal,
): Promise<WorkflowExternalEffectCompletion> {
  if (
    !preparedPlans.has(plan) ||
    !isFreshWorkflowExternalEffectDispatch(dispatch) ||
    dispatch.requestDigest !== plan.requestDigest
  )
    return { state: "not_sent", errorId: ERROR_IDS.WORKFLOW_CONFLICT };
  const current = profile.safeParse(gateway?.profile);
  if (
    gateway === undefined ||
    !current.success ||
    current.data.id !== plan.profileId ||
    current.data.generation !== plan.profileGeneration ||
    !supports(plan.request, current.data.capabilities)
  )
    return { state: "not_sent", errorId: ERROR_IDS.WORKFLOW_NOT_READY };
  if (signal.aborted) return { state: "not_sent", errorId: ERROR_IDS.WORKFLOW_DENIED };
  if (!consumeWorkflowExternalEffectDispatch(dispatch))
    return { state: "not_sent", errorId: ERROR_IDS.WORKFLOW_CONFLICT };
  return invokeOnce(gateway, plan.request, signal);
}
