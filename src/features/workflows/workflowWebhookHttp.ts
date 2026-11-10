import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { admitWorkflowWebhookDelivery } from "./workflowWebhookAdmission";
import {
  validWorkflowWebhookRequestShape,
  type WorkflowWebhookRequest,
} from "./workflowWebhookAuth";
import {
  parseWorkflowWebhookQuery,
  workflowWebhookLimits,
  workflowWebhookPublicationSchema,
} from "./workflowWebhookContract";

const timestampHeader = "x-warpdrive-webhook-timestamp";
const signatureHeader = "x-warpdrive-webhook-signature";
const timestampShape = /^[1-9][0-9]{0,9}$/u;
const signatureShape = /^v1=[a-f0-9]{64}$/u;
const requestTimeoutMs = 15_000;
type AdmissionResult = Awaited<ReturnType<typeof admitWorkflowWebhookDelivery>>;
type BodyError = "invalid-request" | "too-large";

interface WorkflowWebhookHttpServices {
  admit(input: WorkflowWebhookRequest, signal: AbortSignal): Promise<AdmissionResult>;
  nudge(runId: string): Promise<void>;
}

function response(status: number, body: string | null = null): Response {
  return new Response(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function workflowWebhookMethodNotAllowed(request?: Request): Response {
  discardBody(request?.body ?? null);
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
  });
}

function rejectBody(error: BodyError): Response {
  return error === "too-large"
    ? response(413, "Webhook request too large.")
    : response(400, "Invalid webhook request.");
}

function rejectAdmission(error: Extract<AdmissionResult, { ok: false }>["error"]): Response {
  if (error === "invalid-request" || error === "invalid-payload")
    return rejectBody("invalid-request");
  if (
    error === "unauthorized" ||
    error === ERROR_IDS.WORKFLOW_DENIED ||
    error === ERROR_IDS.WORKFLOW_INVALID ||
    error === ERROR_IDS.WORKFLOW_NOT_READY
  )
    return response(404, "Webhook unavailable.");
  if (error === ERROR_IDS.WORKFLOW_CONFLICT) return response(409, "Webhook request conflicted.");
  return response(503, "Webhook unavailable.");
}

function discardBody(body: { cancel(): Promise<void> } | null): void {
  // Cancellation may await an underlying source. It must not delay rejection.
  void body?.cancel().catch(() => {});
}

function declaredBodyLength(headers: Headers): Result<number | null, BodyError> {
  const contentLength = headers.get("content-length");
  const transferEncoding = headers.get("transfer-encoding");
  if (
    transferEncoding !== null &&
    (contentLength !== null || transferEncoding.toLowerCase() !== "chunked")
  )
    return err("invalid-request");
  if (contentLength === null) return ok(null);
  if (!/^[0-9]+$/u.test(contentLength)) return err("invalid-request");
  const length = Number(contentLength);
  return length > workflowWebhookLimits.bodyBytes ? err("too-large") : ok(length);
}

async function readCappedBody(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<Result<Uint8Array, BodyError>> {
  const reader = body.getReader();
  const cancel = () => discardBody(reader);
  signal.addEventListener("abort", cancel, { once: true });
  const buffer = new Uint8Array(workflowWebhookLimits.bodyBytes);
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) return ok(buffer.subarray(0, length));
      if (chunk.value.byteLength > buffer.length - length) {
        cancel();
        return err("too-large");
      }
      buffer.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

async function readWebhookBody(
  request: Request,
  query: string | null,
  signal: AbortSignal,
): Promise<Result<Uint8Array, BodyError>> {
  const { headers, body } = request;
  const declared = declaredBodyLength(headers);
  if (!declared.ok) return declared;
  if (headers.has("content-encoding")) return err("invalid-request");
  if (request.method === "GET") {
    // Fetch may omit the incoming GET stream. Check raw framing headers too.
    if (
      body !== null ||
      headers.has("content-type") ||
      headers.has("transfer-encoding") ||
      (declared.value !== null && declared.value !== 0) ||
      query === null ||
      parseWorkflowWebhookQuery(query) === null
    )
      return err("invalid-request");
    return ok(new Uint8Array());
  }
  if (
    query !== null ||
    !headers.has("content-type") ||
    body === null ||
    body.locked ||
    request.bodyUsed
  )
    return err("invalid-request");
  const bytes = await readCappedBody(body, signal);
  if (bytes.ok && declared.value !== null && bytes.value.byteLength !== declared.value)
    return err("invalid-request");
  return bytes;
}

export async function handleWorkflowWebhookRequest(
  request: Request,
  params: unknown,
  services: WorkflowWebhookHttpServices,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST")
    return workflowWebhookMethodNotAllowed(request);
  const publication = workflowWebhookPublicationSchema.safeParse(params);
  const timestamp = request.headers.get(timestampHeader);
  const signature = request.headers.get(signatureHeader);
  if (
    !publication.success ||
    timestamp === null ||
    !timestampShape.test(timestamp) ||
    signature === null ||
    !signatureShape.test(signature)
  ) {
    discardBody(request.body);
    return response(404, "Webhook unavailable.");
  }
  const queryOffset = request.url.indexOf("?");
  const query = queryOffset === -1 ? null : request.url.slice(queryOffset + 1);
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(requestTimeoutMs)]);
  try {
    const body = await readWebhookBody(request, query, signal);
    if (!body.ok) {
      discardBody(request.body);
      return rejectBody(body.error);
    }
    signal.throwIfAborted();
    const input: WorkflowWebhookRequest = {
      method: request.method,
      publication: publication.data,
      timestamp,
      signature,
      contentType: request.headers.get("content-type"),
      rawBody: body.value,
      ...(query === null ? {} : { rawQuery: query }),
    };
    if (!validWorkflowWebhookRequestShape(input)) return rejectBody("invalid-request");
    const admitted = await services.admit(input, signal);
    if (!admitted.ok) return rejectAdmission(admitted.error);
    if (!admitted.value.replayed) await nudgeCommittedRun(services, admitted.value.runId);
    return response(202);
  } catch {
    discardBody(request.body);
    return response(503, "Webhook unavailable.");
  }
}

async function nudgeCommittedRun(
  services: WorkflowWebhookHttpServices,
  runId: string,
): Promise<void> {
  try {
    await services.nudge(runId);
  } catch {
    // The queue reconciler can pick up an already committed run.
  }
}
