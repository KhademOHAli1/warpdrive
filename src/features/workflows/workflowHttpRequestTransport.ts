import { type RequestOptions, request } from "node:https";
import { checkServerIdentity } from "node:tls";
import type { ApprovedEndpoint, EndpointResolver } from "@/features/connections/connectionEndpoint";
import { resolveConnectionEndpoint } from "@/features/connections/endpointPolicy";
import { err, ok, type Result } from "@/types/result";
import {
  WORKFLOW_HTTP_READ_MAX_BYTES,
  WORKFLOW_HTTP_READ_MAX_HEADER_BYTES,
  WORKFLOW_HTTP_READ_TIMEOUT_MS,
} from "./workflowHttpReadContract";

interface HttpResponse {
  readonly statusCode?: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  on(event: "data", listener: (chunk: unknown) => void): void;
  once(event: "end" | "aborted" | "error" | "close", listener: () => void): void;
  destroy(): void;
}

interface HttpRequest {
  once(event: "error", listener: () => void): void;
  end(body?: string): void;
  destroy(): void;
}

export type WorkflowHttpsTransport = (
  options: RequestOptions,
  receive: (response: HttpResponse) => void,
) => HttpRequest;

export interface WorkflowHttpsDependencies {
  resolver?: EndpointResolver;
  transport?: WorkflowHttpsTransport;
  timeoutMs?: number;
}

export type HttpsFailureReason =
  | "invalid_budget"
  | "destination_denied"
  | "unavailable"
  | "timed_out"
  | "cancelled"
  | "invalid_response"
  | "response_limit";

export type HttpsDisposition = "not-sent" | "response-received" | "unknown";
export interface HttpsExchange<T, Failure> {
  disposition: HttpsDisposition;
  result: Result<T, Failure>;
}

export interface HttpsCommand {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: string;
}

interface ResponsePolicy<T, Failure> {
  failure: (reason: HttpsFailureReason) => Failure;
  beforeDispatch?: () => Result<void, Failure>;
  validate: (response: HttpResponse) => Result<void, Failure>;
  decode: (response: HttpResponse, payload: Buffer) => Result<T, Failure>;
}

function pinnedOptions(
  endpoint: ApprovedEndpoint,
  command: HttpsCommand,
  signal: AbortSignal,
): RequestOptions {
  return {
    protocol: "https:",
    hostname: endpoint.address,
    family: endpoint.family,
    port: endpoint.port,
    path: command.path,
    method: command.method,
    agent: false,
    signal,
    maxHeaderSize: WORKFLOW_HTTP_READ_MAX_HEADER_BYTES,
    joinDuplicateHeaders: true,
    insecureHTTPParser: false,
    ...(endpoint.tls.servername === undefined ? {} : { servername: endpoint.tls.servername }),
    minVersion: endpoint.tls.minVersion,
    rejectUnauthorized: true,
    checkServerIdentity: (_hostname, certificate) =>
      checkServerIdentity(endpoint.hostname, certificate),
    headers: command.headers,
  };
}

function responseLength(response: HttpResponse): Result<number | undefined, HttpsFailureReason> {
  const encoding = response.headers["content-encoding"];
  if (
    encoding !== undefined &&
    (typeof encoding !== "string" || encoding.trim().toLowerCase() !== "identity")
  )
    return err("invalid_response");
  const length = response.headers["content-length"];
  if (length === undefined) return ok(undefined);
  if (typeof length !== "string" || !/^\d{1,9}$/.test(length)) return err("invalid_response");
  const count = Number(length);
  return count > WORKFLOW_HTTP_READ_MAX_BYTES ? err("response_limit") : ok(count);
}

function collectResponse<T, Failure>(
  response: HttpResponse,
  policy: ResponsePolicy<T, Failure>,
  finished: () => boolean,
  finish: (result: Result<T, Failure>) => void,
) {
  const fail = (reason: HttpsFailureReason) => finish(err(policy.failure(reason)));
  const interrupted = () => fail("unavailable");
  response.once("aborted", interrupted);
  response.once("error", interrupted);
  response.once("close", interrupted);
  const admitted = policy.validate(response);
  if (!admitted.ok) {
    finish(admitted);
    return;
  }
  const declared = responseLength(response);
  if (!declared.ok) {
    fail(declared.error);
    return;
  }
  const payload = Buffer.alloc(declared.value ?? WORKFLOW_HTTP_READ_MAX_BYTES);
  let size = 0;
  response.on("data", (chunk) => {
    if (finished()) return;
    if (!Buffer.isBuffer(chunk)) {
      fail("invalid_response");
      return;
    }
    const nextSize = size + chunk.byteLength;
    if (nextSize > WORKFLOW_HTTP_READ_MAX_BYTES) {
      fail("response_limit");
      return;
    }
    if (nextSize > payload.byteLength) {
      fail("invalid_response");
      return;
    }
    chunk.copy(payload, size);
    size = nextSize;
  });
  response.once("end", () => {
    if (finished()) return;
    if (declared.value !== undefined && size !== declared.value) fail("invalid_response");
    else finish(policy.decode(response, payload.subarray(0, size)));
  });
}

const directHttps: WorkflowHttpsTransport = (options, receive) => request(options, receive);

function exchangePinned<T, Failure>(
  options: RequestOptions,
  body: string | undefined,
  signal: AbortSignal,
  stopReason: () => HttpsFailureReason | undefined,
  policy: ResponsePolicy<T, Failure>,
  transport: WorkflowHttpsTransport,
): Promise<HttpsExchange<T, Failure>> {
  return new Promise((resolve) => {
    let settled = false;
    let disposition: HttpsDisposition = "not-sent";
    let outgoing: HttpRequest | undefined;
    let incoming: HttpResponse | undefined;
    function finish(result: Result<T, Failure>) {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      const stopped = stopReason();
      const outcome = stopped === undefined ? result : err(policy.failure(stopped));
      if (!outcome.ok) {
        incoming?.destroy();
        outgoing?.destroy();
      }
      resolve({ disposition, result: outcome });
    }
    function abort() {
      finish(err(policy.failure(stopReason() ?? "unavailable")));
    }
    signal.addEventListener("abort", abort, { once: true });
    if (stopReason() !== undefined) {
      abort();
      return;
    }
    try {
      const admission = policy.beforeDispatch?.();
      if (admission !== undefined && !admission.ok) {
        finish(admission);
        return;
      }
      // Opening a request may write bytes before its factory returns. Treat all
      // errors from this point until HTTP response headers as ambiguous delivery.
      disposition = "unknown";
      outgoing = transport(options, (response) => {
        if (settled) {
          response.destroy();
          return;
        }
        disposition = "response-received";
        incoming = response;
        collectResponse(response, policy, () => settled, finish);
      });
      outgoing.once("error", () => finish(err(policy.failure("unavailable"))));
      if (settled) outgoing.destroy();
      else if (body === undefined) outgoing.end();
      else outgoing.end(body);
    } catch {
      finish(err(policy.failure("unavailable")));
    }
  });
}

export async function exchangeWorkflowHttps<T, Failure>(
  command: HttpsCommand,
  signal: AbortSignal,
  policy: ResponsePolicy<T, Failure>,
  dependencies: WorkflowHttpsDependencies = {},
): Promise<HttpsExchange<T, Failure>> {
  const notSent = (reason: HttpsFailureReason): HttpsExchange<T, Failure> => ({
    disposition: "not-sent",
    result: err(policy.failure(reason)),
  });
  if (signal.aborted) return notSent("cancelled");
  const timeoutMs = dependencies.timeoutMs ?? WORKFLOW_HTTP_READ_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > WORKFLOW_HTTP_READ_TIMEOUT_MS
  )
    return notSent("invalid_budget");
  const deadline = performance.now() + timeoutMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const bounded = AbortSignal.any([signal, timeout]);
  function stopReason(): HttpsFailureReason | undefined {
    if (signal.aborted) return "cancelled";
    if (timeout.aborted || performance.now() >= deadline) return "timed_out";
    return undefined;
  }
  try {
    const endpoint = await resolveConnectionEndpoint(
      { protocol: "https", host: command.hostname, port: command.port },
      { internalEndpoints: [] },
      bounded,
      dependencies.resolver,
    );
    const stopped = stopReason();
    if (stopped !== undefined) return notSent(stopped);
    if (!endpoint.ok)
      return notSent(endpoint.error.code === "dns_failed" ? "unavailable" : "destination_denied");
    return exchangePinned(
      pinnedOptions(endpoint.value, command, bounded),
      command.body,
      bounded,
      stopReason,
      policy,
      dependencies.transport ?? directHttps,
    );
  } catch {
    return notSent(stopReason() ?? "unavailable");
  }
}
