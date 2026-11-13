import { err, ok, type Result } from "@/types/result";
import {
  type CollectorSignatureAuthority,
  OPERATIONS_COLLECTOR_PATH,
  verifyCollectorSignature,
} from "./collectorSignature";
import {
  OPERATIONS_MAX_BODY_BYTES,
  type OperationsSourceBinding,
  operationsSourceBindingSchema,
} from "./contracts";
import type { recordOperationsBatch } from "./repository";

const sourceHeader = "x-warpdrive-collector-source";
const timestampHeader = "x-warpdrive-collector-timestamp";
const signatureHeader = "x-warpdrive-collector-signature";
const requestTimeoutMs = 15_000;
const jsonType = /^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*utf-8)?$/iu;
const canonicalDecimal = /^(?:0|[1-9][0-9]*)$/u;
const signatureShape = /^v1=[a-f0-9]{64}$/u;

type OperationsWriter = (
  binding: OperationsSourceBinding,
  rawBody: string,
  signal: AbortSignal,
) => ReturnType<typeof recordOperationsBatch>;

export interface OperationsCollectorServices {
  lookupAuthority(sourceId: string): CollectorSignatureAuthority | null;
  write: OperationsWriter;
}

type Failure = "invalid_request" | "body_too_large" | "collector_unavailable" | "request_timeout";
type CollectorHeaders = {
  sourceId: string;
  timestamp: string;
  signature: string;
  length: number | null;
};

const failureStatus = {
  invalid_request: 400,
  invalid_payload: 400,
  method_not_allowed: 405,
  body_too_large: 413,
  request_timeout: 408,
  observation_conflict: 409,
  collector_unavailable: 404,
  temporarily_unavailable: 503,
  submission_unknown: 503,
} as const;

function deny(code: keyof typeof failureStatus): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (code === "method_not_allowed") headers.set("Allow", "POST");
  return Response.json({ error: code }, { status: failureStatus[code], headers });
}

function discard(body: { cancel(): Promise<void> } | null): void {
  // An underlying transport can take longer than the response deadline to cancel.
  void body?.cancel().catch(() => {});
}

function rejectRequest(request: Request, error: keyof typeof failureStatus): Response {
  if (!request.bodyUsed && request.body?.locked === false) discard(request.body);
  return deny(error);
}

function matchesTarget(request: Request, rawTarget: string): boolean {
  if (rawTarget !== OPERATIONS_COLLECTOR_PATH) return false;
  const url = new URL(request.url);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    request.url === url.origin + rawTarget
  );
}

function contentLength(headers: Headers): Result<number | null, Failure> {
  const declared = headers.get("content-length");
  const transfer = headers.get("transfer-encoding");
  if (transfer !== null && (declared !== null || transfer.toLowerCase() !== "chunked"))
    return err("invalid_request");
  if (declared === null) return ok(null);
  if (!canonicalDecimal.test(declared) || declared === "0") return err("invalid_request");
  const length = Number(declared);
  return length <= OPERATIONS_MAX_BODY_BYTES ? ok(length) : err("body_too_large");
}

function readHeaders(headers: Headers): Result<CollectorHeaders, Failure> {
  const type = headers.get("content-type");
  if (type === null || type.length > 64 || !jsonType.test(type) || headers.has("content-encoding"))
    return err("invalid_request");
  if (headers.has("cookie") || headers.has("authorization")) return err("invalid_request");
  const length = contentLength(headers);
  if (!length.ok) return length;

  const sourceId = headers.get(sourceHeader);
  const timestamp = headers.get(timestampHeader);
  const signature = headers.get(signatureHeader);
  if (
    sourceId?.length !== 36 ||
    !operationsSourceBindingSchema.shape.sourceId.safeParse(sourceId).success ||
    timestamp === null ||
    timestamp.length > 16 ||
    !canonicalDecimal.test(timestamp) ||
    signature?.length !== 67 ||
    !signatureShape.test(signature)
  )
    return err("collector_unavailable");
  return ok({ sourceId, timestamp, signature, length: length.value });
}

function requestDeadline(requestSignal: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([requestSignal, controller.signal]);
  const limit = performance.now() + requestTimeoutMs;
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  return {
    signal,
    expired() {
      // Progress can be driven by buffered data before the timer callback runs.
      if (performance.now() >= limit) controller.abort();
      return signal.aborted;
    },
    close: () => clearTimeout(timer),
  };
}

type RequestDeadline = ReturnType<typeof requestDeadline>;

function completedBody(
  buffer: Uint8Array | undefined,
  offset: number,
  declared: number | null,
): Result<Uint8Array, Failure> {
  return buffer === undefined || (declared !== null && offset !== declared)
    ? err("invalid_request")
    : ok(buffer.subarray(0, offset));
}

async function readBody(
  body: ReadableStream<Uint8Array>,
  length: number | null,
  deadline: RequestDeadline,
): Promise<Result<Uint8Array, Failure>> {
  if (deadline.expired()) {
    discard(body);
    return err("request_timeout");
  }
  const reader = body.getReader();
  const cancel = () => discard(reader);
  deadline.signal.addEventListener("abort", cancel, { once: true });
  const capacity = length ?? OPERATIONS_MAX_BODY_BYTES;
  let buffer: Uint8Array | undefined;
  let offset = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (deadline.expired()) return err("request_timeout");
      if (next.done) break;
      if (next.value.byteLength > OPERATIONS_MAX_BODY_BYTES - offset) return err("body_too_large");
      if (next.value.byteLength > capacity - offset) return err("invalid_request");
      if (next.value.byteLength === 0) continue;
      buffer ??= new Uint8Array(capacity);
      buffer.set(next.value, offset);
      offset += next.value.byteLength;
    }
    return completedBody(buffer, offset, length);
  } catch {
    return err(deadline.expired() ? "request_timeout" : "invalid_request");
  } finally {
    deadline.signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

type WriteResult = Awaited<ReturnType<OperationsWriter>>;

function writeResponse(result: WriteResult): Response {
  if (result.ok)
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  switch (result.error) {
    case "payload_too_large":
      return deny("body_too_large");
    case "invalid_payload":
    case "source_clock_ahead":
      return deny("invalid_payload");
    case "identity_conflict":
    case "expired_or_out_of_order":
      return deny("observation_conflict");
    case "invalid_source_binding":
    case "generation_mismatch":
    case "source_unavailable":
    case "generation_retired":
    case "source_scope_denied":
      return deny("collector_unavailable");
    case "storage_pressure":
      return deny("temporarily_unavailable");
  }
}

type VerifiedSignature = Extract<
  ReturnType<typeof verifyCollectorSignature>,
  { ok: true }
>["value"];

async function writeBatch(
  write: OperationsWriter,
  verified: VerifiedSignature,
  deadline: RequestDeadline,
): Promise<Response> {
  if (deadline.expired()) return deny("request_timeout");
  let abort = () => {};
  const stopped = new Promise<null>((resolve) => {
    abort = () => resolve(null);
    deadline.signal.addEventListener("abort", abort, { once: true });
  });
  try {
    // This is the only invocation. A rejection or lost acknowledgement after this
    // point cannot establish whether the repository committed the transaction.
    const actual = write(verified.binding, verified.rawBody, deadline.signal);
    const result = await Promise.race([actual, stopped]);
    return result === null || deadline.expired()
      ? deny("submission_unknown")
      : writeResponse(result);
  } catch {
    return deny("submission_unknown");
  } finally {
    deadline.signal.removeEventListener("abort", abort);
  }
}

/** Supply the transport's original request target before any URL normalization. */
export function createOperationsCollectorHandler(services: OperationsCollectorServices) {
  return async (request: Request, rawTarget: string): Promise<Response> => {
    if (request.method !== "POST") return rejectRequest(request, "method_not_allowed");
    if (!matchesTarget(request, rawTarget)) return rejectRequest(request, "invalid_request");
    const headers = readHeaders(request.headers);
    if (!headers.ok) return rejectRequest(request, headers.error);
    const { body } = request;
    if (body === null || body.locked || request.bodyUsed)
      return rejectRequest(request, "invalid_request");

    const deadline = requestDeadline(request.signal);
    const receivedAtMs = Date.now();
    try {
      if (deadline.expired()) return rejectRequest(request, "request_timeout");
      const { sourceId, timestamp, signature, length } = headers.value;
      const authority = services.lookupAuthority(sourceId);
      if (authority?.binding.sourceId !== sourceId)
        return rejectRequest(request, "collector_unavailable");
      const rawBody = await readBody(body, length, deadline);
      if (!rawBody.ok) return deny(rawBody.error);
      const verified = verifyCollectorSignature(
        { method: request.method, path: rawTarget, timestamp, signature, rawBody: rawBody.value },
        authority,
        receivedAtMs,
      );
      if (!verified.ok)
        return deny(
          verified.error === "unauthorized" ? "collector_unavailable" : "invalid_payload",
        );
      return await writeBatch(services.write, verified.value, deadline);
    } catch {
      return rejectRequest(request, "temporarily_unavailable");
    } finally {
      deadline.close();
    }
  };
}
