import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { StepOutput } from "./runTypes";
import type { WorkflowExternalEffectClaim } from "./workflowExternalEffect";
import { workflowHttpOperatorServices } from "./workflowHttpOperatorPolicy";
import { workflowHttpRequestConfig } from "./workflowHttpRequestContract";
import {
  claimWorkflowHttpRequest,
  type WorkflowHttpRequestWorkerContext,
} from "./workflowHttpRequestWorker";

type HttpStep =
  | { status: "external-pending"; claim?: WorkflowExternalEffectClaim }
  | { status: "completed"; output: StepOutput };

function matchingOutput(config: unknown, output: unknown): output is StepOutput {
  const parsed = workflowHttpRequestConfig.safeParse(config);
  if (
    !parsed.success ||
    output === null ||
    typeof output !== "object" ||
    Array.isArray(output) ||
    !Object.hasOwn(output, "status")
  )
    return false;
  const status: unknown = Reflect.get(output, "status");
  if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 299)
    return false;
  const fields = parsed.data.response ?? [];
  if (Object.keys(output).length !== fields.length + 1) return false;
  return fields.every(({ name, type, nullable }) => {
    const key = `result.${name}`;
    if (!Object.hasOwn(output, key)) return false;
    const value: unknown = Reflect.get(output, key);
    if (value === null) return nullable === true;
    if (type === "number") return typeof value === "number" && Number.isFinite(value);
    return typeof value === (type === "text" ? "string" : "boolean");
  });
}

export async function projectWorkflowHttpStep(
  context: WorkflowHttpRequestWorkerContext,
  signal: AbortSignal,
): Promise<Result<HttpStep, string>> {
  if (context.run.iteratorFrame !== null) return err(ERROR_IDS.WORKFLOW_INVALID);
  const claimed = await claimWorkflowHttpRequest(context, workflowHttpOperatorServices, signal);
  if (!claimed.ok) return err(claimed.error.id);
  if (claimed.value.state === "acquired")
    return ok({ status: "external-pending", claim: claimed.value.claim });
  const receipt = claimed.value.effect;
  if (receipt.state === "started") return ok({ status: "external-pending" });
  if (receipt.state === "unknown") return err(ERROR_IDS.WORKFLOW_HTTP_OUTCOME_UNKNOWN);
  if (receipt.state !== "complete" || receipt.errorId !== null)
    return err(receipt.errorId ?? ERROR_IDS.WORKFLOW_WRITE_FAILED);
  return matchingOutput(context.node.config, receipt.output)
    ? ok({ status: "completed", output: receipt.output })
    : err(ERROR_IDS.WORKFLOW_INVALID);
}
