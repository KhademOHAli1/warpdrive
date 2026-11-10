import { createHash } from "node:crypto";
import { err, ok, type Result } from "@/types/result";
import {
  consumeWorkflowExternalEffectDispatch,
  isFreshWorkflowExternalEffectDispatch,
} from "./workflowExternalEffect";
import {
  type WorkflowHttpResponseField,
  workflowHttpRequestLimits,
  workflowHttpsUrl,
} from "./workflowHttpRequestContract";
import {
  authorizeWorkflowHttpRequest,
  type WorkflowHttpRequestFailure,
  type WorkflowHttpRequestPlan,
  type WorkflowHttpRequestPolicy,
  type WorkflowHttpScalar,
  workflowHttpFailure,
  workflowHttpRequestDigest,
} from "./workflowHttpRequestPlan";
import {
  exchangeWorkflowHttps,
  type HttpsExchange,
  type WorkflowHttpsDependencies,
} from "./workflowHttpRequestTransport";

export type {
  WorkflowHttpRequestFailure,
  WorkflowHttpRequestGrant,
  WorkflowHttpRequestPlan,
  WorkflowHttpRequestPolicy,
} from "./workflowHttpRequestPlan";
export { prepareWorkflowHttpRequest } from "./workflowHttpRequestPlan";

export interface WorkflowHttpRequestClaim {
  readonly executionKey: string;
  readonly requestDigest: string;
}

export type WorkflowHttpRequestOutput = { status: number } & Record<
  `result.${string}`,
  WorkflowHttpScalar
>;
export type WorkflowHttpRequestOutcome = HttpsExchange<
  WorkflowHttpRequestOutput,
  WorkflowHttpRequestFailure
>;

const jsonType =
  /^application\/(?:json|[a-z0-9!#$&^_.-]+\+json)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i;
type Projection = Result<WorkflowHttpRequestOutput, WorkflowHttpRequestFailure>;

function typedValue(raw: unknown, field: WorkflowHttpResponseField): raw is WorkflowHttpScalar {
  if (raw === null) return field.nullable === true;
  if (field.type === "boolean") return typeof raw === "boolean";
  if (field.type === "number") return typeof raw === "number" && Number.isFinite(raw);
  return (
    typeof raw === "string" &&
    Buffer.byteLength(raw) <= workflowHttpRequestLimits.outputText &&
    !raw.includes("\0") &&
    !/[\uD800-\uDFFF]/u.test(raw)
  );
}

function projectResponse(
  status: number,
  payload: Buffer,
  fields: readonly WorkflowHttpResponseField[],
): Projection {
  if (fields.length === 0) return ok({ status });
  try {
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
      return err(workflowHttpFailure("invalid_response", status));
    const output: WorkflowHttpRequestOutput = { status };
    for (const field of fields) {
      const value: unknown = Object.hasOwn(raw, field.name)
        ? Reflect.get(raw, field.name)
        : undefined;
      if (!typedValue(value, field)) return err(workflowHttpFailure("invalid_response", status));
      output[`result.${field.name}`] = value;
    }
    return ok(output);
  } catch {
    return err(workflowHttpFailure("invalid_response", status));
  }
}

function responseAdmission(status: number | undefined, media: unknown, typed: boolean) {
  if (status === undefined || !Number.isInteger(status) || status < 100 || status > 599)
    return err(workflowHttpFailure("invalid_response"));
  if (status >= 300 && status < 400) return err(workflowHttpFailure("redirect_denied", status));
  if (status < 200 || status >= 300) return err(workflowHttpFailure("unexpected_status", status));
  return typed && (typeof media !== "string" || !jsonType.test(media.trim()))
    ? err(workflowHttpFailure("invalid_response", status))
    : ok(status);
}

function failedBeforeDispatch(failure: WorkflowHttpRequestFailure): WorkflowHttpRequestOutcome {
  return { disposition: "not-sent", result: err(failure) };
}

function matchingClaim(plan: WorkflowHttpRequestPlan, claim: WorkflowHttpRequestClaim): boolean {
  return (
    /^[A-Za-z0-9_.:-]{1,255}$/.test(claim.executionKey) &&
    /^[a-f0-9]{64}$/.test(claim.requestDigest) &&
    claim.requestDigest === plan.requestDigest &&
    claim.requestDigest === workflowHttpRequestDigest(plan)
  );
}

// The caller passes an exclusive claim only after its transaction commits and
// never reclaims a dispatched/unknown attempt. This performs one HTTPS exchange
// and cannot tell whether an unacknowledged provider mutation was applied.
export async function invokeWorkflowHttpRequest(
  plan: WorkflowHttpRequestPlan,
  claim: WorkflowHttpRequestClaim,
  currentPolicy: WorkflowHttpRequestPolicy,
  signal: AbortSignal,
  dependencies: WorkflowHttpsDependencies = {},
): Promise<WorkflowHttpRequestOutcome> {
  if (signal.aborted) return failedBeforeDispatch(workflowHttpFailure("cancelled"));
  // Only an explicitly injected fixture transport may use a plain test claim.
  const fresh = () =>
    dependencies.transport !== undefined || isFreshWorkflowExternalEffectDispatch(claim);
  if (!fresh()) return failedBeforeDispatch(workflowHttpFailure("invalid_claim"));
  const authorized = authorizeWorkflowHttpRequest(plan, currentPolicy);
  if (!authorized.ok) return failedBeforeDispatch(authorized.error);
  if (!matchingClaim(plan, claim))
    return failedBeforeDispatch(workflowHttpFailure("invalid_claim"));
  const url = workflowHttpsUrl(plan.url);
  if (url === undefined) return failedBeforeDispatch(workflowHttpFailure("invalid_config"));
  const body = plan.body;
  const headers = {
    ...Object.fromEntries(authorized.value),
    Host: url.host,
    "Accept-Encoding": "identity",
    "User-Agent": "Warpdrive Workflow HTTPS",
    ...(body === undefined
      ? {}
      : {
          "Content-Type": body.contentType,
          "Content-Length": String(Buffer.byteLength(body.payload)),
        }),
    ...(plan.method === "GET"
      ? {}
      : {
          "Idempotency-Key": createHash("sha256")
            .update(`warpdrive-workflow-http:${claim.executionKey}`)
            .digest("hex"),
        }),
  };
  return exchangeWorkflowHttps(
    {
      hostname: url.hostname,
      port: url.port === "" ? 443 : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: plan.method,
      headers,
      body: body?.payload,
    },
    signal,
    {
      failure: workflowHttpFailure,
      beforeDispatch: () =>
        dependencies.transport !== undefined || consumeWorkflowExternalEffectDispatch(claim)
          ? ok(undefined)
          : err(workflowHttpFailure("invalid_claim")),
      validate(response) {
        const status = responseAdmission(
          response.statusCode,
          response.headers["content-type"],
          plan.response.length > 0,
        );
        return status.ok ? ok(undefined) : status;
      },
      decode: (response, payload) =>
        projectResponse(response.statusCode ?? 0, payload, plan.response),
    },
    dependencies,
  );
}
