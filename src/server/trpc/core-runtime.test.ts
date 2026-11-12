import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { installSignalShutdown } from "@/server/runtime/shutdown";
import {
  CORE_API_EDGE_BODY_BYTES,
  type CoreRuntimeDependencies,
  type CoreRuntimeOptions,
  createCoreHttpRuntime,
} from "./core-runtime";

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<Value>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function turn() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const options: CoreRuntimeOptions = {
  hostname: "127.0.0.1",
  port: 0,
  idleTimeoutSeconds: 30,
  maxRequestBodyBytes: 16,
  maxAdmittedBodyBytes: 16,
  maxConcurrentRequests: 2,
  bodyTimeoutMs: 1000,
  probeTimeoutMs: 100,
  probeTtlMs: 1000,
};

function request(path = "/api/trpc/example", init?: RequestInit) {
  return new Request(`http://127.0.0.1:8081${path}`, init);
}

function fixture(
  overrides: Partial<CoreRuntimeDependencies> = {},
  config: Partial<CoreRuntimeOptions> = {},
) {
  const order: string[] = [];
  const stop = vi.fn<(force: false) => Promise<void>>(() => {
    order.push("http-stop");
    return Promise.resolve();
  });
  const producer = vi.fn(() => Promise.resolve());
  const detach = vi.fn(() => {
    order.push("detach");
  });
  const stopProducer = vi.fn(() => {
    order.push("producer");
    return Promise.resolve();
  });
  const closeDatabase = vi.fn(() => {
    order.push("database");
    return Promise.resolve();
  });
  const handler = vi.fn<CoreRuntimeDependencies["handler"]>(() =>
    Promise.resolve(new Response("ok")),
  );
  const serve = vi.fn<CoreRuntimeDependencies["serve"]>(() => ({
    url: new URL("http://127.0.0.1:8081/"),
    stop,
  }));
  const probe = vi.fn<CoreRuntimeDependencies["probeReadiness"]>(() => Promise.resolve(true));
  const unavailable = vi.fn();
  const deps: CoreRuntimeDependencies = {
    serve,
    handler,
    startProducer: producer,
    detachProducer: detach,
    stopProducer,
    closeDatabase,
    probeReadiness: probe,
    onUnavailable: unavailable,
    ...overrides,
  };
  const settings = { ...options, ...config };
  const runtime = createCoreHttpRuntime(settings, deps);
  return {
    settings,
    deps,
    runtime,
    order,
    stop,
    producer,
    detach,
    stopProducer,
    closeDatabase,
    handler,
    serve,
    probe,
    unavailable,
  };
}

function owner(runtime: ReturnType<typeof createCoreHttpRuntime>, timeoutMs = 1000) {
  const signals = new EventEmitter();
  const exit = vi.fn();
  const report = vi.fn();
  const shutdown = installSignalShutdown({
    source: "core-api",
    steps: runtime.shutdownSteps(),
    timeoutMs,
    signals,
    exit,
    report,
  });
  return { shutdown, signals, exit, report };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Core HTTP admission and native adapter boundary", () => {
  it("retains admitted budgets and handler identity when caller-owned objects later change", async () => {
    const f = fixture();
    f.settings.maxRequestBodyBytes = 1;
    f.settings.maxConcurrentRequests = 0;
    const replacement = vi.fn(() => Promise.resolve(new Response("replacement")));
    f.deps.handler = replacement;
    await f.runtime.start();
    const response = await f.runtime.fetch(
      request(undefined, { method: "POST", body: "four", headers: { "content-length": "4" } }),
    );
    expect(await response.text()).toBe("ok");
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("requires admitted producer and successful health observation before binding", async () => {
    const admitted = deferred<void>();
    const healthy = deferred<boolean>();
    const f = fixture({
      startProducer: () => admitted.promise,
      probeReadiness: () => healthy.promise,
    });
    const starting = f.runtime.start();
    expect(f.runtime.start()).toBe(starting);
    await turn();
    expect((await f.runtime.fetch(request())).status).toBe(503);
    expect(f.serve).not.toHaveBeenCalled();
    admitted.resolve(undefined);
    await turn();
    expect(f.serve).not.toHaveBeenCalled();
    healthy.resolve(true);
    await starting;
    expect(f.runtime.snapshot().state).toBe("ready");
    expect(f.serve).toHaveBeenCalledTimes(1);
    expect(f.serve.mock.calls[0]?.[0]).toMatchObject({
      hostname: "127.0.0.1",
      port: 0,
      maxRequestBodySize: 16,
      idleTimeout: 30,
    });
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.runtime.url?.href).toBe("http://127.0.0.1:8081/");
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("preserves exact body, cookies, origin, timing and response headers without a replay", async () => {
    const body = '{"v":"ü"}';
    const effect = vi.fn();
    const original = new AbortController();
    const f = fixture({
      handler: async (incoming) => {
        expect(await incoming.text()).toBe(body);
        expect(incoming.headers.get("cookie")).toBe("wd_sid=opaque; wd_csrf=token");
        expect(incoming.headers.get("origin")).toBe("http://public.example.test");
        expect(incoming.headers.get("host")).toBe("public.example.test");
        expect(incoming.signal.aborted).toBe(false);
        effect();
        const headers = new Headers({ "server-timing": "trpc;dur=1.5" });
        headers.append("set-cookie", "first=one");
        headers.append("set-cookie", "second=two");
        return new Response("accepted", { headers });
      },
    });
    await f.runtime.start();
    const response = await f.runtime.fetch(
      request("/api/trpc", {
        method: "POST",
        body,
        signal: original.signal,
        headers: {
          cookie: "wd_sid=opaque; wd_csrf=token",
          origin: "http://public.example.test",
          host: "public.example.test",
          "content-length": String(new TextEncoder().encode(body).byteLength),
        },
      }),
    );
    expect(f.runtime.snapshot()).toMatchObject({ activeRequests: 1 });
    expect(response.headers.get("server-timing")).toBe("trpc;dur=1.5");
    expect(response.headers.getSetCookie()).toEqual(["first=one", "second=two"]);
    expect(await response.text()).toBe("accepted");
    await turn();
    expect(effect).toHaveBeenCalledTimes(1);
    expect(f.runtime.snapshot()).toMatchObject({ activeRequests: 0, admittedBodyBytes: 0 });
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("routes only the exact complete RPC prefix and exposes separate private health/readiness", async () => {
    const f = fixture();
    expect((await f.runtime.fetch(request("/healthz"))).status).toBe(503);
    await f.runtime.start();
    for (const path of [
      "/api/trpcx",
      "/api/trpc-evil/example",
      "/api",
      "/api/auth",
      "/readyz/extra",
    ])
      expect((await f.runtime.fetch(request(path))).status).toBe(404);
    expect((await f.runtime.fetch(request("/healthz"))).status).toBe(200);
    expect((await f.runtime.fetch(request("/readyz"))).status).toBe(200);
    expect((await f.runtime.fetch(request("/readyz", { method: "POST" }))).status).toBe(405);
    expect(await (await f.runtime.fetch(request("/api/trpc/nested.procedure"))).text()).toBe("ok");
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("rejects malformed configuration before startup side effects", () => {
    for (const change of [
      { hostname: " " },
      { port: 65536 },
      { maxConcurrentRequests: 0 },
      { maxRequestBodyBytes: CORE_API_EDGE_BODY_BYTES + 1 },
      { maxAdmittedBodyBytes: 1 },
      { bodyTimeoutMs: 0 },
    ])
      expect(() => fixture({}, change)).toThrow(
        expect.objectContaining({ id: ERROR_IDS.RUNTIME_CORE_API_CONFIGURATION_INVALID }),
      );
  });

  it("rejects declared oversize and malformed lengths before dispatch", async () => {
    const f = fixture();
    await f.runtime.start();
    for (const [length, status] of [
      ["17", 413],
      ["invalid", 400],
      ["1,1", 400],
    ])
      expect(
        (
          await f.runtime.fetch(
            request(undefined, {
              method: "POST",
              body: "x",
              headers: { "content-length": String(length) },
            }),
          )
        ).status,
      ).toBe(status);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.runtime.snapshot().activeRequests).toBe(0);
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("reserves the full cap for unknown length and holds aggregate admission through the response", async () => {
    let input: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        input = controller;
      },
    });
    const f = fixture();
    await f.runtime.start();
    const first = f.runtime.fetch(request(undefined, { method: "POST", body: source }));
    await turn();
    expect(f.runtime.snapshot()).toMatchObject({ activeRequests: 1, admittedBodyBytes: 16 });
    expect(
      (
        await f.runtime.fetch(
          request(undefined, { method: "POST", body: "x", headers: { "content-length": "1" } }),
        )
      ).status,
    ).toBe(503);
    input?.enqueue(new TextEncoder().encode("body"));
    input?.close();
    const response = await first;
    expect(f.runtime.snapshot().admittedBodyBytes).toBe(16);
    await response.text();
    await turn();
    expect(f.runtime.snapshot().admittedBodyBytes).toBe(0);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("limits admitted HTTP requests even when their body reservation is zero", async () => {
    const result = deferred<Response>();
    const handler = vi.fn(() => result.promise);
    const f = fixture({ handler }, { maxConcurrentRequests: 1 });
    await f.runtime.start();
    const first = f.runtime.fetch(request());
    await turn();
    expect((await f.runtime.fetch(request())).status).toBe(503);
    expect(handler).toHaveBeenCalledTimes(1);
    result.resolve(new Response("one"));
    await (await first).text();
    await turn();
    expect(f.runtime.snapshot().activeRequests).toBe(0);
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("requires all bytes before dispatch and rejects overruns, short bodies and lying lengths", async () => {
    for (const [body, length, status] of [
      ["x".repeat(17), null, 413],
      ["sixsix", "5", 400],
      ["sixsix", "7", 400],
    ]) {
      const f = fixture();
      await f.runtime.start();
      const headers = new Headers();
      if (length !== null) headers.set("content-length", String(length));
      const response = await f.runtime.fetch(
        request(undefined, { method: "POST", body: String(body), headers }),
      );
      expect(response.status).toBe(status);
      expect(f.handler).not.toHaveBeenCalled();
      // The exact shutdown barrier observes reader/cancellation settlement;
      // a fixed number of microtasks is not evidence that cleanup finished.
      expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
      expect(f.runtime.snapshot()).toMatchObject({ activeRequests: 0, admittedBodyBytes: 0 });
    }
  });

  it("returns timeout without releasing an abort-ignoring reader's actual cancellation slot", async () => {
    vi.useFakeTimers();
    const cancelled = deferred<void>();
    const cancel = vi.fn(() => cancelled.promise);
    const body = new ReadableStream<Uint8Array>({ cancel });
    const f = fixture();
    await f.runtime.start();
    const pending = f.runtime.fetch(request(undefined, { method: "POST", body }));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe(408);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.runtime.snapshot()).toMatchObject({ activeRequests: 1, admittedBodyBytes: 16 });
    expect((await f.runtime.fetch(request(undefined, { method: "POST", body: "x" }))).status).toBe(
      503,
    );
    expect(f.handler).not.toHaveBeenCalled();
    const drain = owner(f.runtime).shutdown.request();
    await turn();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    cancelled.resolve(undefined);
    expect(await drain).toMatchObject({ status: "drained" });
    expect(f.runtime.snapshot().activeRequests).toBe(0);
  });

  it("retains rejected input cancellation as unknown transport work through the shared deadline", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>({
      cancel: () => Promise.reject(new Error("private input transport state")),
    });
    const f = fixture();
    await f.runtime.start();
    const pending = f.runtime.fetch(request(undefined, { method: "POST", body }));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await pending).status).toBe(408);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.runtime.snapshot()).toMatchObject({
      state: "failed",
      failure: "transport",
      activeRequests: 1,
      admittedBodyBytes: 16,
    });
    const control = owner(f.runtime, 50);
    const drain = control.shutdown.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(await drain).toMatchObject({ status: "timed_out", step: "http", exitCode: 1 });
    expect(f.stopProducer).not.toHaveBeenCalled();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    expect(JSON.stringify(f.unavailable.mock.calls)).not.toContain("private input transport state");
  });

  it("refuses buffered input whose monotonic deadline elapsed before timeout tasks can run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const f = fixture({}, { bodyTimeoutMs: 5 });
    await f.runtime.start();
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        clock = 110;
        controller.enqueue(new TextEncoder().encode("body"));
        controller.close();
      },
    });
    const response = await f.runtime.fetch(request(undefined, { method: "POST", body }));
    expect(response.status).toBe(408);
    expect(f.handler).not.toHaveBeenCalled();
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "drained" });
  });

  it("propagates a real request abort before body dispatch and waits actual cancellation", async () => {
    const signal = new AbortController();
    const cancelled = deferred<void>();
    const body = new ReadableStream<Uint8Array>({ cancel: () => cancelled.promise });
    const f = fixture();
    await f.runtime.start();
    const response = f.runtime.fetch(
      request(undefined, { method: "POST", body, signal: signal.signal }),
    );
    signal.abort();
    expect((await response).status).toBe(400);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.runtime.snapshot().activeRequests).toBe(1);
    const drain = owner(f.runtime).shutdown.request();
    await turn();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    cancelled.resolve(undefined);
    expect(await drain).toMatchObject({ status: "drained" });
    expect(f.runtime.snapshot().activeRequests).toBe(0);
  });

  it("refuses a previously admitted body before dispatch when the producer becomes unavailable", async () => {
    let input: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        input = controller;
      },
    });
    const f = fixture();
    await f.runtime.start();
    const response = f.runtime.fetch(request(undefined, { method: "POST", body }));
    await turn();
    f.runtime.markUnavailable("producer");
    input?.enqueue(new TextEncoder().encode("body"));
    input?.close();
    const reply = await response;
    expect(reply.status).toBe(503);
    expect(f.handler).not.toHaveBeenCalled();
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "failed" });
    expect(f.runtime.snapshot().activeRequests).toBe(0);
  });

  it("still completes a fully admitted body during a healthy graceful drain", async () => {
    let input: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        input = controller;
      },
    });
    const f = fixture();
    await f.runtime.start();
    const response = f.runtime.fetch(request(undefined, { method: "POST", body }));
    await turn();
    const drain = owner(f.runtime).shutdown.request();
    await turn();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    input?.enqueue(new TextEncoder().encode("body"));
    input?.close();
    expect(await (await response).text()).toBe("ok");
    expect(await drain).toMatchObject({ status: "drained" });
    expect(f.handler).toHaveBeenCalledTimes(1);
  });
});

describe("Core response and shared shutdown barriers", () => {
  it("waits both the response stream and native stop(false) before producer and database", async () => {
    const stopped = deferred<void>();
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
    });
    const f = fixture({ handler: () => Promise.resolve(new Response(body)) });
    f.stop.mockImplementation(() => stopped.promise);
    await f.runtime.start();
    const response = await f.runtime.fetch(request());
    const reading = response.text();
    const control = owner(f.runtime);
    const drain = control.shutdown.request();
    await turn();
    expect((await f.runtime.fetch(request())).status).toBe(503);
    expect((await f.runtime.fetch(request("/readyz"))).status).toBe(503);
    expect(f.stop).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.stopProducer).not.toHaveBeenCalled();
    stream?.enqueue(new TextEncoder().encode("complete"));
    stream?.close();
    expect(await reading).toBe("complete");
    await turn();
    expect(f.runtime.snapshot().activeRequests).toBe(0);
    expect(f.closeDatabase).not.toHaveBeenCalled();
    stopped.resolve(undefined);
    expect(await drain).toMatchObject({ source: "core-api", status: "drained", exitCode: 0 });
    expect(f.order).toEqual(["detach", "producer", "database"]);
  });

  it("does not treat native stop resolution as completion of an admitted response stream", async () => {
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const f = fixture({
      handler: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
            }),
          ),
        ),
    });
    await f.runtime.start();
    const response = await f.runtime.fetch(request());
    const reading = response.text();
    const drain = owner(f.runtime).shutdown.request();
    await turn();
    expect(f.stop).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.closeDatabase).not.toHaveBeenCalled();
    stream?.close();
    await reading;
    expect(await drain).toMatchObject({ status: "drained" });
    expect(f.order).toEqual(["http-stop", "detach", "producer", "database"]);
  });

  it("keeps an aborted in-flight command until its actual handler and response cancellation settle", async () => {
    const command = deferred<Response>();
    const cancelled = deferred<void>();
    const handler = vi.fn<CoreRuntimeDependencies["handler"]>(() => command.promise);
    const f = fixture({ handler });
    const signal = new AbortController();
    await f.runtime.start();
    const response = f.runtime.fetch(request(undefined, { signal: signal.signal }));
    await turn();
    signal.abort();
    const drain = owner(f.runtime).shutdown.request();
    await turn();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    command.resolve(
      new Response(new ReadableStream<Uint8Array>({ cancel: () => cancelled.promise })),
    );
    const reply = await response;
    await expect(reply.text()).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STREAM_UNSETTLED,
    });
    expect(f.runtime.snapshot().activeRequests).toBe(1);
    expect(f.closeDatabase).not.toHaveBeenCalled();
    cancelled.resolve(undefined);
    expect(await drain).toMatchObject({ status: "drained" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("explicitly cancels HEAD bodies so suppression by native HTTP cannot strand a slot", async () => {
    const cancelled = deferred<void>();
    const cancel = vi.fn(() => cancelled.promise);
    const f = fixture({
      handler: () => Promise.resolve(new Response(new ReadableStream<Uint8Array>({ cancel }))),
    });
    await f.runtime.start();
    const response = await f.runtime.fetch(request(undefined, { method: "HEAD" }));
    expect(response.body).toBeNull();
    await turn();
    expect(cancel).toHaveBeenCalledTimes(1);
    const drain = owner(f.runtime).shutdown.request();
    await turn();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    cancelled.resolve(undefined);
    expect(await drain).toMatchObject({ status: "drained" });
  });

  it("times out nonzero without late queue/pool closure below a never-ending response", async () => {
    vi.useFakeTimers();
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const f = fixture({
      handler: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                stream = controller;
              },
            }),
          ),
        ),
    });
    await f.runtime.start();
    const response = await f.runtime.fetch(request());
    const reading = response.text();
    const control = owner(f.runtime, 50);
    const result = control.shutdown.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toMatchObject({ status: "timed_out", step: "http", exitCode: 1 });
    expect(f.stopProducer).not.toHaveBeenCalled();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    stream?.close();
    await reading;
    await turn();
    expect(f.stopProducer).not.toHaveBeenCalled();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    expect(control.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("retains an unknown rejected response cancellation and never reports a clean drain", async () => {
    vi.useFakeTimers();
    const f = fixture({
      handler: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              cancel: () => Promise.reject(new Error("private producer state")),
            }),
          ),
        ),
    });
    await f.runtime.start();
    const response = await f.runtime.fetch(request());
    await expect(response.body?.cancel()).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STREAM_UNSETTLED,
    });
    expect(f.runtime.snapshot()).toMatchObject({
      state: "failed",
      activeRequests: 1,
      failure: "transport",
    });
    const control = owner(f.runtime, 50);
    const drain = control.shutdown.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(await drain).toMatchObject({ status: "timed_out", step: "http" });
    expect(f.closeDatabase).not.toHaveBeenCalled();
    expect(JSON.stringify(f.unavailable.mock.calls)).not.toContain("private producer state");
  });

  it("shares one drain across repeated/reentrant signals even during producer startup", async () => {
    const admitted = deferred<void>();
    const f = fixture({ startProducer: () => admitted.promise });
    const control = owner(f.runtime);
    f.stopProducer.mockImplementation(() => {
      control.signals.emit("SIGINT");
      return Promise.resolve();
    });
    const starting = f.runtime.start();
    await turn();
    control.signals.emit("SIGTERM");
    const first = control.shutdown.request();
    expect(control.shutdown.request()).toBe(first);
    await turn();
    admitted.resolve(undefined);
    await starting;
    expect(await first).toMatchObject({ status: "drained" });
    expect(f.serve).not.toHaveBeenCalled();
    expect(f.detach).toHaveBeenCalledTimes(1);
    expect(f.stopProducer).toHaveBeenCalledTimes(1);
    expect(f.closeDatabase).toHaveBeenCalledTimes(1);
  });
});

describe("Core startup and readiness failure", () => {
  it("refuses an elapsed successful probe before timeout tasks can run", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const f = fixture(
      {
        probeReadiness: () => {
          clock = 120;
          return Promise.resolve(true);
        },
      },
      { probeTimeoutMs: 10 },
    );
    const control = owner(f.runtime);
    await expect(f.runtime.start()).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
    });
    expect(f.serve).not.toHaveBeenCalled();
    expect(f.runtime.snapshot().failure).toBe("health");
    expect(await control.shutdown.request()).toMatchObject({ status: "failed" });
  });

  it("refuses binding when a known failure arrives after health confirmation before startup resumes", async () => {
    let confirmed = false;
    let notifyKnownFailure: () => void = () => undefined;
    vi.spyOn(performance, "now").mockImplementation(() => {
      if (confirmed) {
        confirmed = false;
        queueMicrotask(notifyKnownFailure);
      }
      return 100;
    });
    const f = fixture({
      probeReadiness: () => {
        confirmed = true;
        return Promise.resolve(true);
      },
    });
    notifyKnownFailure = () => f.runtime.markUnavailable("producer");
    const control = owner(f.runtime);
    await expect(f.runtime.start()).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
    });
    expect(f.serve).not.toHaveBeenCalled();
    expect(f.runtime.snapshot().failure).toBe("producer");
    expect(await control.shutdown.request()).toMatchObject({ status: "failed" });
  });

  it("cleans partial producer startup through the shared owner and retains startup failure", async () => {
    const f = fixture({
      startProducer: () => Promise.reject(new Error("private connection string")),
    });
    const control = owner(f.runtime);
    await expect(f.runtime.start()).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
    });
    const result = await control.shutdown.request();
    expect(result).toMatchObject({ status: "failed", step: "runtime", exitCode: 1 });
    expect(f.serve).not.toHaveBeenCalled();
    expect(f.order).toEqual(["detach", "producer", "database"]);
    expect(f.unavailable).toHaveBeenCalledExactlyOnceWith("startup");
    expect(JSON.stringify(control.report.mock.calls)).not.toContain("private connection string");
  });

  it("cleans producer and DB after bind failure without claiming a listening server", async () => {
    const f = fixture({
      serve() {
        throw new Error("private bind detail");
      },
    });
    const control = owner(f.runtime);
    await expect(f.runtime.start()).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
    });
    expect(f.runtime.snapshot()).toMatchObject({ state: "failed", failure: "listener" });
    expect(await control.shutdown.request()).toMatchObject({ status: "failed", exitCode: 1 });
    expect(f.order).toEqual(["detach", "producer", "database"]);
    expect(f.runtime.url).toBeNull();
  });

  it("never listens when the admitted producer fails the startup health probe", async () => {
    const f = fixture({ probeReadiness: () => Promise.resolve(false) });
    const control = owner(f.runtime);
    await expect(f.runtime.start()).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
    });
    expect(f.serve).not.toHaveBeenCalled();
    expect(f.unavailable).toHaveBeenCalledExactlyOnceWith("health");
    expect(await control.shutdown.request()).toMatchObject({ status: "failed" });
    expect(f.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it("singleflights cached readiness and latches a known post-start failure without late recovery", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const health = deferred<boolean>();
    const f = fixture();
    await f.runtime.start();
    f.probe.mockImplementation(() => health.promise);
    await vi.advanceTimersByTimeAsync(1001);
    const one = f.runtime.fetch(request("/readyz"));
    const two = f.runtime.fetch(request("/readyz"));
    await turn();
    expect(f.probe).toHaveBeenCalledTimes(2);
    f.runtime.markUnavailable("producer");
    f.runtime.markUnavailable("database");
    expect((await f.runtime.fetch(request())).status).toBe(503);
    health.resolve(true);
    expect((await one).status).toBe(503);
    expect((await two).status).toBe(503);
    expect(f.runtime.snapshot()).toMatchObject({ state: "failed", failure: "producer" });
    expect(f.unavailable).toHaveBeenCalledExactlyOnceWith("producer");
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "failed" });
  });

  it("rechecks known unavailability after awaiting a cached healthy observation", async () => {
    const f = fixture();
    await f.runtime.start();
    const reply = f.runtime.fetch(request("/readyz"));
    f.runtime.markUnavailable("producer");
    expect((await reply).status).toBe(503);
    expect(f.probe).toHaveBeenCalledTimes(1);
    expect(await owner(f.runtime).shutdown.request()).toMatchObject({ status: "failed" });
  });

  it("does not turn an intentional drain cancellation of a ready probe into a fatal incident", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = deferred<boolean>();
    const f = fixture();
    await f.runtime.start();
    f.probe.mockImplementation((signal) => {
      signal.addEventListener(
        "abort",
        () => pending.reject(new Error("owned probe cancellation")),
        { once: true },
      );
      return pending.promise;
    });
    await vi.advanceTimersByTimeAsync(1001);
    const response = f.runtime.fetch(request("/readyz"));
    await turn();
    expect(f.runtime.snapshot().probeActive).toBe(true);
    const drain = owner(f.runtime).shutdown.request();
    expect((await response).status).toBe(503);
    expect(await drain).toMatchObject({ status: "drained", exitCode: 0 });
    expect(f.unavailable).not.toHaveBeenCalled();
  });

  it("can drain startup while its initial readiness probe is deliberately cancelled", async () => {
    const pending = deferred<boolean>();
    const f = fixture({
      probeReadiness(signal) {
        signal.addEventListener(
          "abort",
          () => pending.reject(new Error("owned startup cancellation")),
          { once: true },
        );
        return pending.promise;
      },
    });
    const starting = f.runtime.start();
    await turn();
    expect(f.runtime.snapshot().probeActive).toBe(true);
    const drain = owner(f.runtime).shutdown.request();
    await starting;
    expect(await drain).toMatchObject({ status: "drained", exitCode: 0 });
    expect(f.serve).not.toHaveBeenCalled();
    expect(f.unavailable).not.toHaveBeenCalled();
  });

  it("keeps an abort-ignoring actual health query through timeout and shared drain", async () => {
    vi.useFakeTimers();
    const health = deferred<boolean>();
    const f = fixture({ probeReadiness: () => health.promise });
    const control = owner(f.runtime, 50);
    const starting = f.runtime.start();
    const rejected = expect(starting).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STARTUP_FAILED,
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(f.runtime.snapshot()).toMatchObject({
      state: "failed",
      probeActive: true,
      failure: "health",
    });
    expect(f.serve).not.toHaveBeenCalled();
    const drain = control.shutdown.request();
    await vi.advanceTimersByTimeAsync(50);
    expect(await drain).toMatchObject({ status: "timed_out", step: "http" });
    expect(f.stopProducer).not.toHaveBeenCalled();
    expect(f.closeDatabase).not.toHaveBeenCalled();
    health.resolve(true);
    await turn();
    expect(f.runtime.snapshot().failure).toBe("health");
    expect(f.stopProducer).not.toHaveBeenCalled();
    expect(f.closeDatabase).not.toHaveBeenCalled();
  });
});
