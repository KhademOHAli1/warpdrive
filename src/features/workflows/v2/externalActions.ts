import { eq } from "drizzle-orm";
import {
  workflowV2LogicFunctions,
  workflowV2RuntimeSettings,
} from "@/db/schema/workflowV2Functions";
import type { BlockOutput, ExternalActionExecutor } from "@/features/blocks/contracts";
import { assertMailboxOwner } from "@/features/email/mailboxOwnership";
import { sendEmail, sendEmailInput } from "@/features/email/send";
import { resolveSendConnection } from "@/features/email/sendConnection";
import { readOwnedSendStatus } from "@/features/email/sendStatus";
import { makeStorageClient } from "@/features/files/storage";
import { err, ok } from "@/types/result";
import { executeWorkflowAi } from "./aiActions";
import { runWorkflowCode } from "./codeSandbox";
import { safeWorkflowHttpRequest } from "./httpTransport";
import { matchesResponseSchema } from "./responseSchema";

type ActionContext = Parameters<ExternalActionExecutor>[0];
type ActionResult = ReturnType<ExternalActionExecutor>;
export const executeExternalAction: ExternalActionExecutor = (context, node, config) => {
  context.signal.throwIfAborted();
  if (node.type === "CODE" || node.type === "LOGIC_FUNCTION")
    return executeCode(context, node.type, config);
  if (context.mode === "test")
    return Promise.resolve(err({ id: "E_WORKFLOW_EXTERNAL_TEST_FORBIDDEN" }));
  if (node.type === "AI_AGENT" || node.type === "CLASSIFY")
    return executeWorkflowAi(context.db, node.type, config, context.signal);
  if (node.type === "HTTP_REQUEST") return executeHttp(context, config);
  if (node.type === "SEND_EMAIL") return executeEmail(context, config);
  return Promise.resolve(err({ id: "E_WORKFLOW_EXTERNAL_UNSUPPORTED" }));
};

async function executeCode(
  { db, signal }: ActionContext,
  type: "CODE" | "LOGIC_FUNCTION",
  config: BlockOutput,
): ActionResult {
  let sourceCode = typeof config.sourceCode === "string" ? config.sourceCode : "";
  let outputSchema = config.outputSchema;
  const inputs = config.inputs ?? {};
  if (type === "LOGIC_FUNCTION") {
    if (typeof config.functionId !== "string") return err({ id: "E_WORKFLOW_FUNCTION_INPUT" });
    const [fn] = await db
      .select()
      .from(workflowV2LogicFunctions)
      .where(eq(workflowV2LogicFunctions.id, config.functionId));
    if (fn === undefined || !matchesResponseSchema(fn.inputSchema, inputs))
      return err({ id: "E_WORKFLOW_FUNCTION_INPUT" });
    sourceCode = fn.sourceCode;
    outputSchema = fn.outputSchema;
  }
  const result = await runWorkflowCode({ sourceCode, inputs, outputSchema }, signal);
  return result.ok
    ? ok(
        result.value !== null && typeof result.value === "object" && !Array.isArray(result.value)
          ? result.value
          : { value: result.value },
      )
    : err({ id: result.error });
}
async function executeHttp({ db, signal }: ActionContext, config: BlockOutput): ActionResult {
  if (typeof config.url !== "string" || typeof config.method !== "string")
    return err({ id: "E_WORKFLOW_HTTP_URL" });
  const [runtime] = await db
    .select({ internalEndpoints: workflowV2RuntimeSettings.internalEndpoints })
    .from(workflowV2RuntimeSettings)
    .limit(1);
  const headers =
    config.headers !== null && typeof config.headers === "object" && !Array.isArray(config.headers)
      ? Object.fromEntries(
          Object.entries(config.headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  const result = await safeWorkflowHttpRequest(
    {
      url: config.url,
      method: config.method,
      headers,
      body: config.method === "GET" || config.method === "HEAD" ? undefined : config.body,
      responseSchema: config.responseSchema,
    },
    signal,
    { policy: { internalEndpoints: runtime?.internalEndpoints ?? [] } },
  );
  return result.ok ? ok({ ...result.value }) : result;
}

async function executeEmail(context: Parameters<ExternalActionExecutor>[0], config: BlockOutput) {
  const { db, actor, signal } = context;
  const parsed = sendEmailInput.safeParse({ ...config, idempotencyKey: context.effectKey });
  if (!parsed.success) return err({ id: "E_WORKFLOW_EMAIL_INPUT" });
  const input = parsed.data;
  const owner = await assertMailboxOwner(db, input.accountId, actor.id, signal);
  if (!owner.ok) return err({ id: owner.error.id });
  const receipt = await readOwnedSendStatus(db, {
    accountId: input.accountId,
    actorId: actor.id,
    idempotencyKey: context.effectKey,
    signal,
  });
  if (!receipt.ok) return err({ id: receipt.error.id });
  if (receipt.value?.outcome.status === "needs_review")
    return err({ id: "E_WORKFLOW_EMAIL_UNKNOWN", outcome: "unknown" as const });
  if (receipt.value?.outcome.status === "sent")
    return ok({
      status: "sent",
      attemptId: receipt.value.outcome.attemptId ?? null,
      messageId: receipt.value.outcome.messageId ?? null,
    });
  const connection = await resolveSendConnection(db, {
    accountId: input.accountId,
    actorId: actor.id,
    idempotencyKey: context.effectKey,
    signal,
  });
  if (!connection.ok) return err({ id: connection.error.id });
  const result = await sendEmail(db, {
    actorId: actor.id,
    actorType: actor.type,
    actorGroupIds: actor.groupIds,
    ...connection.value,
    storage: makeStorageClient(),
    input,
    signal,
  });
  if (!result.ok) return err({ id: result.error.id, outcome: "unknown" as const });
  if (result.value.status === "needs_review" || result.value.deliveryOutcome?.state === "unknown")
    return err({ id: "E_WORKFLOW_EMAIL_UNKNOWN", outcome: "unknown" as const });
  return ok({
    status: result.value.status,
    attemptId: result.value.attemptId ?? null,
    messageId: result.value.messageId ?? null,
  });
}
