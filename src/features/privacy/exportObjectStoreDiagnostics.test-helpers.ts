import { createHash } from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import { performance } from "node:perf_hooks";
import type { Readable } from "node:stream";
import { urlToHttpOptions } from "node:url";
import { Client } from "minio";
import { createSeaweedReadiness } from "./exportObjectStoreReadiness.test-helpers";
import type { ExportStoreConfig } from "./exportObjectStoreTypes";

type ErrorKind = "timeout" | "abort" | "connection_reset" | "connection_refused" | "other";
type Operation = "versioning" | "initiate" | "upload_part" | "abort_upload" | "other";
type Event = {
  atMs: number;
  phase: "request" | "body_finish" | "headers" | "end" | "abort" | "error" | "server";
  request?: number;
  operation?: Operation;
  length?: number;
  status?: number;
  checksumMatches?: boolean;
  errorKind?: ErrorKind;
  label?: string;
  version?: string;
  memberCount?: number;
  expectedMemberMatches?: boolean;
};

export function diagnosticErrorKind(cause: unknown): ErrorKind {
  if (typeof cause !== "object" || cause === null) return "other";
  const name = "name" in cause ? cause.name : undefined;
  const nested = "cause" in cause ? cause.cause : undefined;
  if (
    name === "TimeoutError" ||
    (typeof nested === "object" &&
      nested !== null &&
      "name" in nested &&
      nested.name === "TimeoutError")
  )
    return "timeout";
  if (name === "AbortError") return "abort";
  const code = "code" in cause ? cause.code : undefined;
  if (code === "ECONNRESET") return "connection_reset";
  return code === "ECONNREFUSED" ? "connection_refused" : "other";
}

function operationKind(options: http.RequestOptions, endpoint: URL): Operation {
  const query = new URL(options.path ?? "/", endpoint).searchParams;
  if (options.method === "PUT" && query.has("partNumber")) return "upload_part";
  if (options.method === "POST" && query.has("uploads")) return "initiate";
  if (options.method === "DELETE" && query.has("uploadId")) return "abort_upload";
  return query.has("versioning") ? "versioning" : "other";
}

function headerValue(
  headers: http.OutgoingHttpHeaders | readonly string[] | undefined,
  name: string,
): string | undefined {
  const entries: [string, unknown][] = Object.entries(headers ?? {});
  const value = entries.find(([key]) => key.toLowerCase() === name)?.[1];
  return typeof value === "number" || typeof value === "string" ? String(value) : undefined;
}
function contentLength(
  headers: http.OutgoingHttpHeaders | readonly string[] | undefined,
): number | undefined {
  const value = headerValue(headers, "content-length");
  const number = value === undefined ? Number.NaN : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

// Only static labels leave this observer; partial raw input is capped at 2 KiB.
const SERVER_EVENTS: readonly [RegExp, string][] = [
  [/leader (?:changed|change)|become leader|elected.*leader/iu, "leader_change"],
  [/no leader|not leader|leader.*unavailable|waiting.*leader/iu, "leader_unavailable"],
  [/register.*volume|volume.*registered|added.*volume server/iu, "volume_registration"],
  [/start seaweed volume server/iu, "volume_server_start"],
  [
    /assign.*volume|assign.*file id|allocat.*volume|grow.*volume|new volume|creat.*volume/iu,
    "volume_allocation",
  ],
  [
    /assign.*(?:fail|error)|(?:fail|error).*assign|no writable volume|grow.*fail/iu,
    "allocation_failure",
  ],
  [/write.*(?:fail|error)|(?:fail|error).*write/iu, "write_failure"],
  // Pinned glog text headers and source prefixes prevent matching arbitrary payload text.
  [
    /^I\d{4} \d{2}:\d{2}:\d{2}\.\d{6} filer_grpc_server_dlm\.go:\d+ FILER LOCK: Error - name=[^\r\n]* error=no lock server found$/u,
    "lock_server_unavailable",
  ],
  [
    /^I\d{4} \d{2}:\d{2}:\d{2}\.\d{6} filer_grpc_server_dlm\.go:\d+ FILER LOCK: Forward failed - name=[^\r\n]* err=[^\r\n]+$/u,
    "lock_forward_failed",
  ],
  [
    /^W\d{4} \d{2}:\d{2}:\d{2}\.\d{6} lock_client\.go:\d+ create lock [^\r\n]+: [^\r\n]+$/u,
    "lock_acquire_failed",
  ],
  [
    /^W\d{4} \d{2}:\d{2}:\d{2}\.\d{6} s3api_object_handlers_put\.go:\d+ withObjectWriteLock: objectWriteLock: failed to acquire lock for [^\r\n]+$/u,
    "object_lock_acquire_failed",
  ],
];

function miniProgressLabel(line: string): string | undefined {
  // Anchored enum alternatives ensure only this fixed set of progress labels can leave.
  const progress =
    /^\s*(Master|Volume|Filer|S3|Admin)\s+(starting|ready|failed|stopped)(?:\s+\d+(?:\.\d+)?s)?\s*$/u.exec(
      line,
    );
  const service = progress?.[1];
  const state = progress?.[2];
  return service === undefined || state === undefined
    ? undefined
    : `mini_${service.toLowerCase()}_${state}`;
}

export function createStorageDiagnostics(expectedBody: Uint8Array) {
  const started = performance.now();
  const readiness = createSeaweedReadiness();
  const expectedMd5 = createHash("md5").update(expectedBody).digest("base64");
  const wire: Event[] = [];
  const server: Event[] = [];
  let droppedEvents = 0;
  let truncatedLogChunks = 0;
  let nextRequest = 0;
  const logDelivery = {
    consumersAttached: 0,
    dataChunks: 0,
    errChunks: 0,
    bytes: 0,
    completeLines: 0,
    matchedLines: 0,
    errors: 0,
    ends: 0,
    closes: 0,
  };
  const record = (event: Omit<Event, "atMs">) => {
    const target = event.phase === "server" ? server : wire;
    target.push({ atMs: Math.round((performance.now() - started) * 10) / 10, ...event });
    if (target.length > 64) {
      target.shift();
      droppedEvents++;
    }
  };
  const observeLogs = (stream: Readable) => {
    logDelivery.consumersAttached++;
    let pending = "";
    const classifyLine = (line: string) => {
      logDelivery.completeLines++;
      const progress = miniProgressLabel(line);
      const ring = readiness.observeLine(line);
      let matched = progress !== undefined || ring !== undefined;
      if (progress !== undefined) record({ phase: "server", label: progress });
      if (ring !== undefined) record({ phase: "server", ...ring });
      for (const [pattern, label] of SERVER_EVENTS) {
        if (pattern.test(line)) {
          record({ phase: "server", label });
          matched = true;
        }
      }
      if (matched) logDelivery.matchedLines++;
    };
    const consume = (chunk: unknown) => {
      if (!(typeof chunk === "string" || Buffer.isBuffer(chunk))) return;
      logDelivery.bytes +=
        typeof chunk === "string" ? Buffer.byteLength(chunk, "utf8") : chunk.length;
      if (chunk.length > 8192) truncatedLogChunks++;
      const text =
        typeof chunk === "string" ? chunk.slice(0, 8192) : chunk.toString("utf8", 0, 8192);
      const lines = `${pending}${text}`.split(/\r?\n/u);
      pending = (lines.pop() ?? "").slice(-2048);
      for (const line of lines) classifyLine(line);
    };
    const onData = (chunk: unknown) => {
      logDelivery.dataChunks++;
      consume(chunk);
    };
    const onErr = (chunk: unknown) => {
      logDelivery.errChunks++;
      consume(chunk);
    };
    const onError = () => {
      logDelivery.errors++;
      record({ phase: "server", label: "log_stream_error" });
    };
    const onEnd = () => {
      logDelivery.ends++;
      if (pending.length > 0) classifyLine(pending);
      pending = "";
    };
    stream.on("data", onData);
    stream.on("err", onErr);
    stream.on("error", onError);
    stream.once("end", onEnd);
    stream.once("close", () => {
      logDelivery.closes++;
      pending = "";
      stream.removeListener("data", onData);
      stream.removeListener("err", onErr);
      stream.removeListener("error", onError);
      stream.removeListener("end", onEnd);
    });
  };
  const client = (config: ExportStoreConfig, signal: AbortSignal): Client => {
    const endpoint = new URL(config.endpoint);
    function request(
      input: string | URL | http.RequestOptions,
      optionsOrCallback?: http.RequestOptions | ((response: http.IncomingMessage) => void),
      callback?: (response: http.IncomingMessage) => void,
    ): http.ClientRequest {
      signal.throwIfAborted();
      const options =
        typeof input === "string" || input instanceof URL
          ? {
              ...urlToHttpOptions(new URL(input)),
              ...(typeof optionsOrCallback === "object" ? optionsOrCallback : {}),
            }
          : input;
      const handler = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
      const requestId = ++nextRequest;
      const operation = operationKind(options, endpoint);
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(config.requestTimeoutMs)]);
      const base = { request: requestId, operation };
      record({
        ...base,
        phase: "request",
        length: contentLength(options.headers),
        checksumMatches:
          operation === "upload_part"
            ? headerValue(options.headers, "content-md5") === expectedMd5
            : undefined,
      });
      const onAbort = () =>
        record({ ...base, phase: "abort", errorKind: diagnosticErrorKind(bounded.reason) });
      bounded.addEventListener("abort", onAbort, { once: true });
      const onResponse = (response: http.IncomingMessage) => {
        const length = contentLength(response.headers);
        record({ ...base, phase: "headers", status: response.statusCode, length });
        const onEnd = () => record({ ...base, phase: "end", length });
        const onError = (cause: unknown) =>
          record({ ...base, phase: "error", errorKind: diagnosticErrorKind(cause) });
        response.once("end", onEnd);
        response.once("error", onError);
        response.once("close", () => {
          response.removeListener("end", onEnd);
          response.removeListener("error", onError);
        });
        handler?.(response);
      };
      const outgoing =
        endpoint.protocol === "https:"
          ? https.request({ ...options, signal: bounded }, onResponse)
          : http.request({ ...options, signal: bounded }, onResponse);
      outgoing.once("finish", () =>
        record({ ...base, phase: "body_finish", length: contentLength(options.headers) }),
      );
      outgoing.once("error", (cause: unknown) =>
        record({ ...base, phase: "error", errorKind: diagnosticErrorKind(cause) }),
      );
      outgoing.once("close", () => bounded.removeEventListener("abort", onAbort));
      return outgoing;
    }
    return new Client({
      endPoint: endpoint.hostname,
      port:
        endpoint.port.length > 0
          ? Number(endpoint.port)
          : endpoint.protocol === "https:"
            ? 443
            : 80,
      useSSL: endpoint.protocol === "https:",
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      region: "us-east-1",
      pathStyle: true,
      transport: { request },
      retryOptions: { disableRetry: true },
    });
  };
  return {
    client,
    observeLogs,
    readiness,
    snapshot: () => ({
      events: [...wire, ...server].sort((a, b) => a.atMs - b.atMs),
      droppedEvents,
      truncatedLogChunks,
      logDelivery: { ...logDelivery },
      readiness: readiness.snapshot(),
    }),
  };
}
