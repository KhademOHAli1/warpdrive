import { createHash } from "node:crypto";
import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import { resolveRunBinding } from "./runBindings";
import type { RunOutputs } from "./runTypes";
import type { Binding, WorkflowDefinition } from "./schemas";
import {
  isWorkflowHttpHeaderName,
  isWorkflowHttpHeaderValue,
  type WorkflowHttpMethod,
  type WorkflowHttpRequestConfig,
  type WorkflowHttpResponseField,
  workflowHttpRequestConfig,
  workflowHttpRequestLimits,
  workflowHttpsUrl,
} from "./workflowHttpRequestContract";
import type { HttpsFailureReason } from "./workflowHttpRequestTransport";

export type WorkflowHttpScalar = string | number | boolean | null;
export type WorkflowHttpRequestFailureReason =
  | HttpsFailureReason
  | "invalid_config"
  | "unauthorized"
  | "binding_missing"
  | "grant_denied"
  | "invalid_claim"
  | "redirect_denied"
  | "unexpected_status";

export interface WorkflowHttpRequestFailure {
  id: string;
  reason: WorkflowHttpRequestFailureReason;
  status?: number;
}

export function workflowHttpFailure(
  reason: WorkflowHttpRequestFailureReason,
  status?: number,
): WorkflowHttpRequestFailure {
  let id: string = ERROR_IDS.WORKFLOW_INVALID;
  switch (reason) {
    case "unauthorized":
    case "grant_denied":
    case "destination_denied":
      id = ERROR_IDS.WORKFLOW_DENIED;
      break;
    case "binding_missing":
      id = ERROR_IDS.WORKFLOW_BINDING_MISSING;
      break;
    case "unavailable":
    case "timed_out":
    case "cancelled":
    case "unexpected_status":
      id = ERROR_IDS.WORKFLOW_NOT_READY;
      break;
    case "invalid_budget":
    case "invalid_claim":
    case "invalid_config":
    case "invalid_response":
    case "redirect_denied":
    case "response_limit":
      break;
  }
  return status === undefined ? { id, reason } : { id, reason, status };
}

// Grants are current operator-owned policy, never taken from a workflow draft
// or job payload. A URL is exact including its path and query string.
export interface WorkflowHttpRequestGrant {
  readonly url: string;
  readonly methods: readonly WorkflowHttpMethod[];
  readonly authoredHeaders?: readonly string[];
  readonly operatorHeaders?: Readonly<Record<string, string>>;
}

export interface WorkflowHttpRequestPolicy {
  readonly isWorkspaceAdmin: boolean;
  readonly canRunWorkflow: boolean;
  readonly grants: readonly WorkflowHttpRequestGrant[];
}

interface RequestBody {
  readonly contentType: "text/plain; charset=utf-8" | "application/json";
  readonly payload: string;
}

type HeaderPair = readonly [name: string, value: string];

export interface WorkflowHttpRequestPlan {
  readonly url: string;
  readonly method: WorkflowHttpMethod;
  readonly headers: readonly HeaderPair[];
  readonly body?: RequestBody;
  readonly response: readonly Readonly<WorkflowHttpResponseField>[];
  readonly requestDigest: string;
}

type PlanResult<T> = Result<T, WorkflowHttpRequestFailure>;
const fail = (reason: WorkflowHttpRequestFailureReason) => err(workflowHttpFailure(reason));

function authorized(policy: WorkflowHttpRequestPolicy): boolean {
  return policy.isWorkspaceAdmin === true && policy.canRunWorkflow === true;
}

export function workflowHttpRequestDigest(plan: Omit<WorkflowHttpRequestPlan, "requestDigest">) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "warpdrive-workflow-http-request-v1",
        plan.method,
        plan.url,
        plan.headers,
        plan.body,
        plan.response,
      ]),
    )
    .digest("hex");
}

function approvedGrant(
  plan: Pick<WorkflowHttpRequestPlan, "url" | "method">,
  policy: WorkflowHttpRequestPolicy,
) {
  const grants = policy.grants.filter((grant) => workflowHttpsUrl(grant.url)?.href === plan.url);
  const grant = grants[0];
  return grants.length === 1 && grant?.methods.includes(plan.method) === true ? grant : undefined;
}

function grantedHeaders(grant: WorkflowHttpRequestGrant, authored: readonly HeaderPair[]) {
  const allow = new Set((grant.authoredHeaders ?? []).map((name) => name.toLowerCase()));
  const supplied = Object.entries(grant.operatorHeaders ?? {});
  if (supplied.length > workflowHttpRequestLimits.headers) return null;
  const operators = new Map<string, string>();
  for (const [name, value] of supplied) {
    const lower = name.toLowerCase();
    if (
      operators.has(lower) ||
      !isWorkflowHttpHeaderName(name, true) ||
      !isWorkflowHttpHeaderValue(value)
    )
      return null;
    operators.set(lower, value);
  }
  if (authored.some(([name]) => !allow.has(name) || operators.has(name))) return null;
  return [...operators, ...authored];
}

export function authorizeWorkflowHttpRequest(
  plan: WorkflowHttpRequestPlan,
  policy: WorkflowHttpRequestPolicy,
): PlanResult<readonly HeaderPair[]> {
  if (!authorized(policy)) return fail("unauthorized");
  const grant = approvedGrant(plan, policy);
  if (grant === undefined) return fail("grant_denied");
  const headers = grantedHeaders(grant, plan.headers);
  if (headers === null) return fail("grant_denied");
  const bytes = headers.reduce(
    (total, [name, value]) => total + Buffer.byteLength(name) + Buffer.byteLength(value) + 4,
    0,
  );
  return bytes <= workflowHttpRequestLimits.headerBytes ? ok(headers) : fail("invalid_config");
}

interface Input {
  node: { id: string; version: number; config: unknown };
  outputs: RunOutputs;
  definition: WorkflowDefinition;
  policy: WorkflowHttpRequestPolicy;
}

type ResolveBinding = (binding: Binding, path: readonly string[]) => PlanResult<WorkflowHttpScalar>;

function resolveInput({ node, outputs, definition }: Input): ResolveBinding {
  return (binding, path) => {
    if (binding.kind === "value") return ok(binding.value);
    const resolved = resolveRunBinding(binding, outputs, { definition, nodeId: node.id, path });
    switch (resolved.state) {
      case "missing":
        return fail("binding_missing");
      case "invalid":
        return fail("invalid_config");
      case "null":
        return ok(null);
      case "value":
        return ok(resolved.value);
    }
  };
}

function resolvedHeaders(
  config: WorkflowHttpRequestConfig,
  resolve: ResolveBinding,
): PlanResult<readonly HeaderPair[]> {
  const headers: HeaderPair[] = [];
  for (const [index, header] of (config.headers ?? []).entries()) {
    const value = resolve(header.value, ["headers", String(index), "value"]);
    if (!value.ok) return value;
    if (typeof value.value !== "string" || !isWorkflowHttpHeaderValue(value.value))
      return fail("invalid_config");
    headers.push(Object.freeze([header.name, value.value]));
  }
  return ok(Object.freeze(headers));
}

function resolvedBody(
  body: WorkflowHttpRequestConfig["body"],
  resolve: ResolveBinding,
): PlanResult<RequestBody | undefined> {
  if (body === undefined) return ok(undefined);
  if (body.kind === "text") {
    const value = resolve(body.value, ["body", "value"]);
    if (!value.ok) return value;
    return typeof value.value === "string" &&
      !value.value.includes("\0") &&
      Buffer.byteLength(value.value) <= workflowHttpRequestLimits.bodyBytes
      ? ok(Object.freeze({ contentType: "text/plain; charset=utf-8", payload: value.value }))
      : fail("invalid_config");
  }
  const values: [string, WorkflowHttpScalar][] = [];
  for (const [index, field] of body.fields.entries()) {
    const value = resolve(field.value, ["body", "fields", String(index), "value"]);
    if (!value.ok) return value;
    values.push([field.name, value.value]);
  }
  const payload = JSON.stringify(Object.fromEntries(values));
  return Buffer.byteLength(payload) <= workflowHttpRequestLimits.bodyBytes
    ? ok(Object.freeze({ contentType: "application/json", payload }))
    : fail("invalid_config");
}

export function prepareWorkflowHttpRequest(input: Input): PlanResult<WorkflowHttpRequestPlan> {
  if (!authorized(input.policy)) return fail("unauthorized");
  if (input.node.version !== 1) return fail("invalid_config");
  const config = workflowHttpRequestConfig.safeParse(input.node.config);
  if (!config.success) return fail("invalid_config");
  const resolve = resolveInput(input);
  const resolved = resolve(config.data.url, ["url"]);
  if (!resolved.ok) return resolved;
  const url = workflowHttpsUrl(resolved.value);
  if (url === undefined) return fail("invalid_config");
  const headers = resolvedHeaders(config.data, resolve);
  if (!headers.ok) return headers;
  const body = resolvedBody(config.data.body, resolve);
  if (!body.ok) return body;
  const draft = {
    url: url.href,
    method: config.data.method,
    headers: headers.value,
    body: body.value,
    response: Object.freeze((config.data.response ?? []).map((field) => Object.freeze(field))),
  };
  const plan = Object.freeze({ ...draft, requestDigest: workflowHttpRequestDigest(draft) });
  const approved = authorizeWorkflowHttpRequest(plan, input.policy);
  return approved.ok ? ok(plan) : approved;
}
