import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkerCallbackTracker,
  installSignalShutdown,
  workerShutdownSteps,
} from "./shutdown";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe("bounded signal shutdown", () => {
  it("does not advance dependencies after elapsed time even before a deadline timer runs", async () => {
    let now = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const database = vi.fn();
    try {
      const shutdown = installSignalShutdown({
        source: "core-api",
        timeoutMs: 100,
        signals: new EventEmitter(),
        exit: vi.fn(),
        report: vi.fn(),
        steps: [
          {
            name: "http",
            run: () => {
              now = 101;
            },
          },
          { name: "database", run: database },
        ],
      });
      expect(await shutdown.request()).toMatchObject({
        status: "timed_out",
        step: "http",
        exitCode: 1,
      });
      expect(database).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });
  it("shares one drain across repeated/reentrant signals and closes in order", async () => {
    const signals = new EventEmitter();
    const active = deferred();
    const order: string[] = [];
    const exit = vi.fn();
    const report = vi.fn();
    const shutdown = installSignalShutdown({
      source: "worker",
      timeoutMs: 1000,
      signals,
      exit,
      report,
      steps: [
        {
          name: "consumers",
          async run() {
            order.push("consumers");
            signals.emit("SIGINT");
            await active.promise;
          },
        },
        {
          name: "queue",
          run: () => {
            order.push("queue");
          },
        },
        {
          name: "database",
          run: () => {
            order.push("database");
          },
        },
      ],
    });
    signals.emit("SIGTERM");
    const first = shutdown.request();
    expect(shutdown.request()).toBe(first);
    await Promise.resolve();
    expect(order).toEqual(["consumers"]);
    signals.emit("SIGTERM");
    active.resolve();
    expect(await first).toMatchObject({ status: "drained", exitCode: 0 });
    expect(order).toEqual(["consumers", "queue", "database"]);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
    expect(signals.listenerCount("SIGINT")).toBe(0);
  });

  it("times out nonzero without closing dependencies beneath unfinished work", async () => {
    vi.useFakeTimers();
    const active = deferred();
    const closePool = vi.fn();
    const exit = vi.fn();
    const shutdown = installSignalShutdown({
      source: "worker",
      timeoutMs: 100,
      signals: new EventEmitter(),
      exit,
      report: vi.fn(),
      steps: [
        { name: "consumers", run: () => active.promise },
        { name: "database", run: closePool },
      ],
    });
    const result = shutdown.request();
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ status: "timed_out", step: "consumers", exitCode: 1 });
    expect(closePool).not.toHaveBeenCalled();
    active.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(closePool).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("reports failures without exception contents and does not report clean drain", async () => {
    const closePool = vi.fn();
    const report = vi.fn();
    const exit = vi.fn();
    const shutdown = installSignalShutdown({
      source: "realtime",
      timeoutMs: 1000,
      signals: new EventEmitter(),
      exit,
      report,
      steps: [
        { name: "sockets", run: () => Promise.reject(new Error("private credential payload")) },
        { name: "database", run: closePool },
      ],
    });
    expect(await shutdown.request()).toMatchObject({
      status: "failed",
      step: "sockets",
      exitCode: 1,
    });
    expect(JSON.stringify(report.mock.calls)).not.toContain("private credential payload");
    expect(closePool).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("still exits if a diagnostics sink fails", async () => {
    const exit = vi.fn();
    const shutdown = installSignalShutdown({
      source: "worker",
      timeoutMs: 1000,
      signals: new EventEmitter(),
      exit,
      report() {
        throw new Error("sink closed");
      },
      steps: [],
    });
    expect(await shutdown.request()).toMatchObject({ status: "drained", exitCode: 0 });
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });
});

describe("pg-boss shutdown ordering", () => {
  it("holds the actual callback when expiry silently releases offWork after drain begins", async () => {
    vi.useFakeTimers();
    const callbacks = createWorkerCallbackTracker();
    const active = deferred();
    const libraryStopped = deferred();
    const registrations: unknown[][] = [];
    const boss = {
      work: (...arguments_: unknown[]) => {
        registrations.push(arguments_);
        return Promise.resolve("work-id");
      },
      getWipData: () => [{ name: "active" }, { name: "idle" }],
      offWork: vi.fn(() => libraryStopped.promise),
      stop: vi.fn(),
    };
    callbacks.install(boss);
    await boss.work("active", () => active.promise);
    const callback = registrations[0]![1] as () => Promise<void>;
    const actualHandler = callback();
    let ready!: (runtime: typeof boss) => void;
    const starting = new Promise<typeof boss>((resolve) => {
      ready = resolve;
    });
    const closePool = vi.fn();
    const detach = vi.fn();
    const exit = vi.fn();
    const shutdown = installSignalShutdown({
      source: "worker",
      timeoutMs: 100,
      signals: new EventEmitter(),
      exit,
      report: vi.fn(),
      steps: workerShutdownSteps(starting, closePool, detach, callbacks),
    });
    const result = shutdown.request();
    ready(boss);
    await vi.advanceTimersByTimeAsync(20);
    // Installed stopSignal is already aborted: a subsequent expiration releases
    // pg-boss's wait WITHOUT emitting handler_overrun. The callback itself still runs.
    libraryStopped.resolve();
    await vi.advanceTimersByTimeAsync(30);
    expect(exit).not.toHaveBeenCalled();
    expect(boss.stop).not.toHaveBeenCalled();
    expect(closePool).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toMatchObject({ status: "timed_out", step: "consumers", exitCode: 1 });
    expect(boss.offWork.mock.calls).toEqual([
      ["active", { wait: true }],
      ["idle", { wait: true }],
    ]);
    expect(boss.stop).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
    expect(closePool).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    active.resolve();
    await actualHandler;
    await Promise.resolve();
    expect(closePool).not.toHaveBeenCalled();
  });

  it("drains after an abandoned callback actually settles without a sticky false hold", async () => {
    const callbacks = createWorkerCallbackTracker();
    const active = deferred();
    const registrations: unknown[][] = [];
    const boss = {
      work: (...arguments_: unknown[]) => {
        registrations.push(arguments_);
        return Promise.resolve("work-id");
      },
      getWipData: () => [{ name: "active" }],
      offWork: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
    };
    callbacks.install(boss);
    await boss.work("active", { batchSize: 1 }, () => active.promise);
    const handler = registrations[0]![2] as () => Promise<void>;
    const actualHandler = handler();
    const closePool = vi.fn(() => Promise.resolve());
    const shutdown = installSignalShutdown({
      source: "worker",
      timeoutMs: 1000,
      signals: new EventEmitter(),
      exit: vi.fn(),
      report: vi.fn(),
      steps: workerShutdownSteps(Promise.resolve(boss), closePool, vi.fn(), callbacks),
    });
    const result = shutdown.request();
    await Promise.resolve();
    await Promise.resolve();
    expect(closePool).not.toHaveBeenCalled();
    active.resolve();
    await actualHandler;
    expect(await result).toMatchObject({ status: "drained", exitCode: 0 });
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it("captures a prefetched callback that starts before offWork's runPromise barrier settles", async () => {
    const callbacks = createWorkerCallbackTracker();
    const active = deferred();
    const libraryStopped = deferred();
    const registrations: unknown[][] = [];
    const boss = {
      work: (...arguments_: unknown[]) => {
        registrations.push(arguments_);
        return Promise.resolve("work-id");
      },
      getWipData: () => [{ name: "prefetched" }],
      offWork: vi.fn(() => libraryStopped.promise),
      stop: vi.fn(() => Promise.resolve()),
    };
    callbacks.install(boss);
    await boss.work("prefetched", () => active.promise);
    const steps = workerShutdownSteps(Promise.resolve(boss), vi.fn(), vi.fn(), callbacks);
    let drained = false;
    const draining = Promise.resolve(steps[0]!.run()).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(boss.offWork).toHaveBeenCalledTimes(1);
    const actualHandler = (registrations[0]![1] as () => Promise<void>)();
    libraryStopped.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(drained).toBe(false);
    active.resolve();
    await actualHandler;
    await draining;
    expect(drained).toBe(true);
  });

  it("stops idle and active queues before waiting, then closes queue and pool", async () => {
    const active = deferred();
    const order: string[] = [];
    const boss = {
      work: () => Promise.resolve("work-id"),
      getWipData: () => [{ name: "active" }, { name: "idle" }, { name: "active" }],
      offWork: vi.fn((name: string, options: { wait: true }) => {
        expect(options.wait).toBe(true);
        order.push(`stop:${name}`);
        return name === "active" ? active.promise : Promise.resolve();
      }),
      stop: vi.fn((options: { graceful: true; timeout: number }) => {
        expect(options).toEqual({ graceful: true, timeout: 30_000 });
        order.push("queue");
        return Promise.resolve();
      }),
    };
    const callbacks = createWorkerCallbackTracker();
    callbacks.install(boss);
    const steps = workerShutdownSteps(
      Promise.resolve(boss),
      () => {
        order.push("database");
        return Promise.resolve();
      },
      () => {
        order.push("detach");
      },
      callbacks,
    );
    const draining = steps[0]!.run();
    await Promise.resolve();
    expect(order).toEqual(["stop:active", "stop:idle"]);
    expect(boss.stop).not.toHaveBeenCalled();
    active.resolve();
    await draining;
    await steps[1]!.run();
    await steps[2]!.run();
    expect(order).toEqual(["stop:active", "stop:idle", "detach", "queue", "database"]);
    expect(boss.offWork).toHaveBeenCalledTimes(2);
  });

  it("waits for other consumers before surfacing one drain rejection", async () => {
    const active = deferred();
    const boss = {
      work: () => Promise.resolve("work-id"),
      getWipData: () => [{ name: "failed" }, { name: "active" }],
      offWork: (name: string) =>
        name === "failed" ? Promise.reject(new Error("failed")) : active.promise,
      stop: vi.fn(),
    };
    const callbacks = createWorkerCallbackTracker();
    callbacks.install(boss);
    const steps = workerShutdownSteps(Promise.resolve(boss), vi.fn(), vi.fn(), callbacks);
    let settled = false;
    const result = Promise.resolve(steps[0]!.run()).catch(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    active.resolve();
    await result;
    expect(settled).toBe(true);
    expect(boss.stop).not.toHaveBeenCalled();
  });
});

describe("registered worker callback tracking", () => {
  function registrationHarness() {
    const registrations: unknown[][] = [];
    const receivers: unknown[] = [];
    const boss = {
      work: function (this: unknown, ...arguments_: unknown[]): Promise<string> {
        registrations.push(arguments_);
        receivers.push(this);
        return Promise.resolve("work-id");
      },
    };
    const callbacks = createWorkerCallbackTracker();
    callbacks.install(boss);
    return { callbacks, boss, registrations, receivers };
  }

  it("preserves both overload shapes, options, callback context, transactional argument and result", async () => {
    const { callbacks, boss, registrations, receivers } = registrationHarness();
    const jobs = [{ id: "synthetic" }];
    const transaction = { executeSql: vi.fn() };
    const context = { marker: "callback-context" };
    const answer = Promise.resolve({ accepted: true });
    const handler = vi.fn(function (
      this: unknown,
      actualJobs: unknown,
      actualTransaction: unknown,
    ) {
      expect(this).toBe(context);
      expect(actualJobs).toBe(jobs);
      expect(actualTransaction).toBe(transaction);
      return answer;
    });
    const options = { transactional: true, batchSize: 2 };
    expect(await boss.work("simple", handler)).toBe("work-id");
    expect(await boss.work("transactional", options, handler)).toBe("work-id");
    expect(registrations[0]!.length).toBe(2);
    expect(registrations[1]!.length).toBe(3);
    expect(registrations[1]![1]).toBe(options);
    expect(receivers).toEqual([boss, boss]);
    for (const registration of registrations) {
      const tracked = registration[registration.length - 1] as (
        ...arguments_: unknown[]
      ) => unknown;
      expect(Reflect.apply(tracked, context, [jobs, transaction])).toBe(answer);
    }
    callbacks.beginDrain();
    callbacks.finishConsumerStop();
    await callbacks.waitForSettled();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("keeps synchronous throws and asynchronous rejections visible to the original queue", async () => {
    const { callbacks, boss, registrations } = registrationHarness();
    const synchronous = new Error("synthetic sync failure");
    const asynchronous = new Error("synthetic async failure");
    await boss.work("sync", () => {
      throw synchronous;
    });
    await boss.work("async", () => Promise.reject(asynchronous));
    const syncHandler = registrations[0]![1] as () => unknown;
    const asyncHandler = registrations[1]![1] as () => unknown;
    expect(syncHandler).toThrow(synchronous);
    await expect(asyncHandler()).rejects.toBe(asynchronous);
    callbacks.beginDrain();
    callbacks.finishConsumerStop();
    await expect(callbacks.waitForSettled()).resolves.toBeUndefined();
  });

  it("blocks new registrations and rejects impossible post-barrier callbacks before user code", async () => {
    const { callbacks, boss, registrations } = registrationHarness();
    const handler = vi.fn(() => Promise.resolve());
    await boss.work("existing", handler);
    callbacks.beginDrain();
    await expect(boss.work("late-registration", handler)).rejects.toThrow(
      "registrations are closed",
    );
    expect(registrations).toHaveLength(1);
    callbacks.finishConsumerStop();
    const wrapped = registrations[0]![1] as () => Promise<void>;
    await expect(wrapped()).rejects.toThrow("after the consumer-stop barrier");
    expect(handler).not.toHaveBeenCalled();
    await expect(callbacks.waitForSettled()).rejects.toThrow("after the consumer-stop barrier");
  });
});
