import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ShutdownStep } from "@/server/runtime/shutdown";

/** Body admission preserves the existing edge envelope; it is not an RSS or batch-work bound. */
export const CORE_API_EDGE_BODY_BYTES = 80 * 1024 ** 2;

export interface CoreHttpServer {
  readonly url: URL;
  /** Must resolve only after actual connections and their responses have drained. */
  stop(closeActiveConnections: false): Promise<void>;
}

export interface CoreServeOptions {
  hostname: string;
  port: number;
  idleTimeout: number;
  maxRequestBodySize: number;
  fetch(request: Request): Promise<Response>;
  error(): Response;
}

export type CoreUnavailableReason =
  | "startup"
  | "producer"
  | "database"
  | "listener"
  | "health"
  | "transport";
type RuntimeState = "new" | "starting" | "ready" | "draining" | "closed" | "failed";

export interface CoreRuntimeOptions {
  hostname: string;
  /** Zero is admitted for an explicitly owned test listener. Production configuration chooses a port. */
  port: number;
  idleTimeoutSeconds: number;
  maxRequestBodyBytes: number;
  maxAdmittedBodyBytes: number;
  maxConcurrentRequests: number;
  bodyTimeoutMs: number;
  probeTimeoutMs: number;
  probeTtlMs: number;
}

export interface CoreRuntimeDependencies {
  serve(options: CoreServeOptions): CoreHttpServer;
  /** The complete existing Fetch tRPC handler, not a replacement read-only router. */
  handler(request: Request): Promise<Response>;
  /** Includes strict queue admission; no consumer registration or runtime migrations. */
  startProducer(): Promise<void>;
  detachProducer(): void;
  /** Must account for partially started producer resources when startup rejects. */
  stopProducer(): Promise<void>;
  closeDatabase(): Promise<void>;
  /** A cheap bounded DB/producer observation. The full catalog is admitted at startup. */
  probeReadiness(signal: AbortSignal): Promise<boolean>;
  onUnavailable?(reason: CoreUnavailableReason): void | Promise<void>;
}

export interface CoreRuntimeSnapshot {
  state: RuntimeState;
  activeRequests: number;
  admittedBodyBytes: number;
  probeActive: boolean;
  failure: CoreUnavailableReason | null;
}

type BodyFailure = { ok: false; status: 400 | 408 | 413 };
type BodyResult = BodyFailure | { ok: true; request: Request };
type BodyRead = { result: BodyResult; settled: Promise<void> };
type Lease = { release(): void };
type BodyChunks = { ok: true; chunks: Uint8Array<ArrayBuffer>[] };

function fixedResponse(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}

function validInteger(value: number, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function validateOptions(options: CoreRuntimeOptions): void {
  if (
    options.hostname.length === 0 ||
    options.hostname.length > 253 ||
    /[\s\0/]/u.test(options.hostname) ||
    !validInteger(options.port, 0, 65535) ||
    !validInteger(options.idleTimeoutSeconds, 1, 255) ||
    !validInteger(options.maxRequestBodyBytes, 1, CORE_API_EDGE_BODY_BYTES) ||
    !validInteger(
      options.maxAdmittedBodyBytes,
      options.maxRequestBodyBytes,
      Number.MAX_SAFE_INTEGER,
    ) ||
    !validInteger(options.maxConcurrentRequests, 1, 128) ||
    !validInteger(options.bodyTimeoutMs, 1, 2_147_483_647) ||
    !validInteger(options.probeTimeoutMs, 1, 2_147_483_647) ||
    !validInteger(options.probeTtlMs, 1, 2_147_483_647)
  )
    throw new AppError(
      ERROR_IDS.RUNTIME_CORE_API_CONFIGURATION_INVALID,
      "Core API runtime configuration is invalid",
    );
}

function declaredLength(request: Request): number | null | "invalid" {
  const value = request.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d{1,16}$/u.test(value)) return "invalid";
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : "invalid";
}

function isRpcPath(path: string): boolean {
  return path === "/api/trpc" || path.startsWith("/api/trpc/");
}

async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maximum: number,
  expected: number | null,
  interruption: () => BodyFailure | undefined,
  fail: (status: BodyFailure["status"]) => BodyFailure,
): Promise<BodyChunks | BodyFailure> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  for (;;) {
    const before = interruption();
    if (before !== undefined) return before;
    const next = await reader.read();
    const after = interruption();
    if (after !== undefined) return after;
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > maximum) return fail(413);
    if (expected !== null && bytes > expected) return fail(400);
    const copy = new Uint8Array(next.value.byteLength);
    copy.set(next.value);
    chunks.push(copy);
  }
  if (expected !== null && bytes !== expected) return fail(400);
  return { ok: true, chunks };
}

/** Verify complete input bytes before a command can start. No JSON/DTO interpretation occurs here. */
async function readBody(
  request: Request,
  maximum: number,
  expected: number | null,
  timeoutMs: number,
): Promise<BodyRead> {
  if (request.signal.aborted)
    return { result: { ok: false, status: 400 }, settled: Promise.resolve() };
  if (request.body === null)
    return {
      result:
        expected === null || expected === 0 ? { ok: true, request } : { ok: false, status: 400 },
      settled: Promise.resolve(),
    };

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    return { result: { ok: false, status: 400 }, settled: Promise.resolve() };
  }
  let failure: BodyFailure | undefined;
  let cancellation: Promise<unknown> | undefined;
  const deadline = performance.now() + timeoutMs;
  let failResult: (result: BodyFailure) => void = () => undefined;
  const failed = new Promise<BodyFailure>((resolve) => {
    failResult = resolve;
  });
  const fail = (status: BodyFailure["status"]): BodyFailure => {
    if (failure !== undefined) return failure;
    failure = { ok: false, status };
    // A cancelled caller is not evidence that the reader has already settled.
    cancellation = Promise.resolve().then(() => reader.cancel());
    // Observe early rejection without changing the actual cleanup promise.
    void cancellation.catch(() => undefined);
    failResult(failure);
    return failure;
  };
  const abort = () => fail(400);
  const interruption = (): BodyFailure | undefined => {
    if (failure !== undefined) return failure;
    return performance.now() >= deadline ? fail(408) : undefined;
  };
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => fail(408), timeoutMs);
  const consuming = (async (): Promise<BodyResult> => {
    try {
      const read = await readChunks(reader, maximum, expected, interruption, fail);
      if (!read.ok) return read;
      const body = new Blob(read.chunks);
      const prepared = new Request(request, { body, signal: request.signal });
      return interruption() ?? { ok: true, request: prepared };
    } catch {
      return fail(400);
    }
  })();
  const settled = consuming
    .then(async () => {
      await cancellation;
    })
    .finally(() => {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
      reader.releaseLock();
    });
  return { result: await Promise.race([consuming, failed]), settled };
}

/**
 * One optional process boundary for the full existing RPC handler. Source-level body/request
 * admission does not bound RPCs inside a batch, response materialization or process RSS.
 */
export function createCoreHttpRuntime(
  configuration: CoreRuntimeOptions,
  dependencies: CoreRuntimeDependencies,
) {
  const options = Object.freeze({ ...configuration });
  validateOptions(options);
  const deps = Object.freeze({
    serve: dependencies.serve.bind(dependencies),
    handler: dependencies.handler.bind(dependencies),
    startProducer: dependencies.startProducer.bind(dependencies),
    detachProducer: dependencies.detachProducer.bind(dependencies),
    stopProducer: dependencies.stopProducer.bind(dependencies),
    closeDatabase: dependencies.closeDatabase.bind(dependencies),
    probeReadiness: dependencies.probeReadiness.bind(dependencies),
    onUnavailable: dependencies.onUnavailable?.bind(dependencies),
  });
  let state: RuntimeState = "new";
  let failure: CoreUnavailableReason | null = null;
  let draining = false;
  let server: CoreHttpServer | undefined;
  let starting: Promise<void> | undefined;
  let producerTouched = false;
  let admittedBodyBytes = 0;
  const active = new Set<Promise<void>>();
  let stopServer: Promise<void> | undefined;
  let stopProducer: Promise<void> | undefined;
  let closeDatabase: Promise<void> | undefined;
  let detached = false;
  let healthyUntil = 0;
  let probe:
    | { actual: Promise<void>; result: Promise<boolean>; controller: AbortController }
    | undefined;

  function markUnavailable(reason: CoreUnavailableReason): void {
    if (failure !== null || state === "closed") return;
    failure = reason;
    state = "failed";
    healthyUntil = 0;
    try {
      void Promise.resolve(deps.onUnavailable?.(reason)).catch(() => undefined);
    } catch {
      // Diagnostics/shutdown notification cannot turn a known failure back into readiness.
    }
  }

  function beginDrain(): void {
    draining = true;
    healthyUntil = 0;
    if (failure === null && state !== "closed") state = "draining";
    probe?.controller.abort();
  }

  function isReady(): boolean {
    return state === "ready" && !draining && failure === null;
  }

  function isDraining(): boolean {
    return draining;
  }

  function hasFailed(): boolean {
    return failure !== null;
  }

  function observeReadiness(): Promise<boolean> {
    if (draining || failure !== null) return Promise.resolve(false);
    if (performance.now() < healthyUntil) return Promise.resolve(true);
    if (probe !== undefined) return probe.result;
    const controller = new AbortController();
    let timedOut = false;
    let expire: (healthy: false) => void = () => undefined;
    const expired = new Promise<false>((resolve) => {
      expire = resolve;
    });
    const deadline = performance.now() + options.probeTimeoutMs;
    const expireProbe = () => {
      timedOut = true;
      controller.abort();
      if (!draining) markUnavailable("health");
      expire(false);
    };
    const timer = setTimeout(expireProbe, options.probeTimeoutMs);
    const observation = Promise.resolve()
      .then(() => deps.probeReadiness(controller.signal))
      .then(
        (healthy) => {
          if (timedOut || draining || failure !== null) return false;
          if (performance.now() >= deadline) {
            expireProbe();
            return false;
          }
          if (healthy !== true) {
            markUnavailable("health");
            return false;
          }
          healthyUntil = performance.now() + options.probeTtlMs;
          return true;
        },
        () => {
          if (!draining) markUnavailable("health");
          return false;
        },
      );
    const token = {
      controller,
      result: Promise.race([observation, expired]),
      actual: Promise.resolve(),
    };
    token.actual = observation
      .then(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        if (probe === token) probe = undefined;
      });
    probe = token;
    return token.result;
  }

  function lease(bytes: number): Lease {
    let complete: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      complete = resolve;
    });
    active.add(settled);
    admittedBodyBytes += bytes;
    let released = false;
    return {
      release() {
        if (released) return;
        released = true;
        admittedBodyBytes -= bytes;
        active.delete(settled);
        complete();
      },
    };
  }

  function ownResponse(response: Response, request: Request, reservation: Lease): Response {
    if (response.body === null) {
      reservation.release();
      return response;
    }
    if (response.body.locked) {
      markUnavailable("transport");
      // The owner of this locked stream is unknown. Keep the barrier until process failure.
      return fixedResponse(500, "Core API response unavailable");
    }
    const reader = response.body.getReader();
    let closing: Promise<void> | undefined;
    let output: ReadableStreamDefaultController<Uint8Array> | undefined;
    const finish = (cancel: boolean): Promise<void> => {
      closing ??= Promise.resolve()
        .then(async () => {
          if (cancel) await reader.cancel();
          reader.releaseLock();
          request.signal.removeEventListener("abort", abort);
          reservation.release();
        })
        .catch(() => {
          markUnavailable("transport");
          throw new AppError(
            ERROR_IDS.RUNTIME_CORE_API_STREAM_UNSETTLED,
            "Core API response did not settle",
          );
        });
      return closing;
    };
    const abort = () => {
      try {
        output?.error(
          new AppError(
            ERROR_IDS.RUNTIME_CORE_API_STREAM_UNSETTLED,
            "Core API response interrupted",
          ),
        );
      } catch {
        // The consumer may already have closed its side of the response.
      }
      void finish(true).catch(() => undefined);
    };
    if (request.method === "HEAD") {
      // A native HTTP server may suppress HEAD body consumption. Explicitly
      // cancel the owned body while keeping its real cancellation as the barrier.
      void finish(true).catch(() => undefined);
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller;
      },
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            await finish(false);
          } else controller.enqueue(next.value);
        } catch {
          try {
            controller.error(
              new AppError(
                ERROR_IDS.RUNTIME_CORE_API_STREAM_UNSETTLED,
                "Core API response interrupted",
              ),
            );
          } catch {
            // Already cancelled/errored by the transport.
          }
          await finish(true);
        }
      },
      cancel: () => finish(true),
    });
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  async function healthResponse(request: Request, path: string): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD")
      return fixedResponse(405, "Method not allowed");
    const healthy =
      path === "/healthz"
        ? failure === null && (state === "ready" || state === "draining")
        : isReady() && (await observeReadiness()) && isReady();
    return fixedResponse(healthy ? 200 : 503, healthy ? "OK" : "Unavailable");
  }

  async function fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/healthz" || path === "/readyz") return healthResponse(request, path);
    if (!isRpcPath(path)) return fixedResponse(404, "Not found");
    if (!isReady()) return fixedResponse(503, "Unavailable");
    const length = declaredLength(request);
    if (length === "invalid") return fixedResponse(400, "Invalid request body");
    if (length !== null && length > options.maxRequestBodyBytes)
      return fixedResponse(413, "Request body too large");
    const bytes = request.body === null ? 0 : (length ?? options.maxRequestBodyBytes);
    if (
      active.size >= options.maxConcurrentRequests ||
      bytes > options.maxAdmittedBodyBytes - admittedBodyBytes
    )
      return fixedResponse(503, "Core API admission busy");
    const reservation = lease(bytes);
    let prepared: BodyRead;
    try {
      prepared = await readBody(
        request,
        options.maxRequestBodyBytes,
        length,
        options.bodyTimeoutMs,
      );
    } catch {
      reservation.release();
      return fixedResponse(400, "Invalid request body");
    }
    if (!prepared.result.ok) {
      void prepared.settled.then(
        () => reservation.release(),
        () => markUnavailable("transport"),
      );
      return fixedResponse(prepared.result.status, "Invalid request body");
    }
    try {
      await prepared.settled;
    } catch {
      markUnavailable("transport");
      // A reader whose completion cannot be proved retains its reservation.
      return fixedResponse(500, "Core API request unavailable");
    }
    if (request.signal.aborted) {
      reservation.release();
      return fixedResponse(400, "Request cancelled");
    }
    if (failure !== null) {
      // The request was admitted before this failure, but no command has started.
      // A healthy graceful drain may finish admitted work; a known fatal failure may not.
      reservation.release();
      return fixedResponse(503, "Unavailable");
    }
    let response: Response;
    try {
      response = await deps.handler(prepared.result.request);
    } catch {
      reservation.release();
      return fixedResponse(500, "Core API request failed");
    }
    try {
      return ownResponse(response, request, reservation);
    } catch {
      markUnavailable("transport");
      // A response that could not be owned must not be mistaken for a finished command.
      return fixedResponse(500, "Core API response unavailable");
    }
  }

  const stopHttp = () => {
    beginDrain();
    stopServer ??= Promise.resolve().then(async () => {
      await starting?.catch(() => undefined);
      await server?.stop(false);
      while (active.size > 0) await Promise.all([...active]);
      await probe?.actual;
    });
    return stopServer;
  };
  const stopQueue = () => {
    stopProducer ??= Promise.resolve().then(async () => {
      if (!producerTouched) return;
      if (!detached) {
        detached = true;
        deps.detachProducer();
      }
      await deps.stopProducer();
    });
    return stopProducer;
  };
  const stopDatabase = () => {
    closeDatabase ??= Promise.resolve().then(async () => {
      await deps.closeDatabase();
      state = failure === null ? "closed" : "failed";
    });
    return closeDatabase;
  };
  function shutdownSteps(): ShutdownStep[] {
    return [
      { name: "http", run: stopHttp },
      { name: "producer", run: stopQueue },
      { name: "database", run: stopDatabase },
      {
        name: "runtime",
        run() {
          if (failure !== null)
            throw new AppError(ERROR_IDS.RUNTIME_CORE_API_DRAIN_FAILED, "Core API runtime failed");
        },
      },
    ];
  }

  function start(): Promise<void> {
    starting ??= Promise.resolve().then(async () => {
      if (isDraining()) return;
      state = "starting";
      try {
        producerTouched = true;
        await deps.startProducer();
        if (isDraining()) return;
        const healthy = await observeReadiness();
        if (isDraining()) return;
        if (!healthy || hasFailed())
          throw new AppError(ERROR_IDS.RUNTIME_CORE_API_HEALTH_FAILED, "Core API admission failed");
        try {
          server = deps.serve({
            hostname: options.hostname,
            port: options.port,
            idleTimeout: options.idleTimeoutSeconds,
            maxRequestBodySize: options.maxRequestBodyBytes,
            fetch,
            error: () => fixedResponse(500, "Core API transport failed"),
          });
        } catch {
          markUnavailable("listener");
          throw new AppError(ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED, "Core API listener failed");
        }
        if (!isDraining() && failure === null) state = "ready";
      } catch {
        markUnavailable("startup");
        // The owner must request the returned shared shutdown steps on this rejection.
        // A competing cleanup chain could close dependencies after its deadline expired.
        throw new AppError(ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED, "Core API startup failed");
      }
    });
    return starting;
  }

  return {
    start,
    fetch,
    beginDrain,
    markUnavailable,
    shutdownSteps,
    get url(): URL | null {
      return server === undefined ? null : new URL(server.url);
    },
    snapshot(): CoreRuntimeSnapshot {
      return {
        state,
        activeRequests: active.size,
        admittedBodyBytes,
        probeActive: probe !== undefined,
        failure,
      };
    },
  };
}
