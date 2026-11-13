import type { PgBoss } from "pg-boss";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

type ShutdownSignal = "SIGTERM" | "SIGINT";
type SignalSource = {
  on(signal: ShutdownSignal, listener: () => void): unknown;
  off(signal: ShutdownSignal, listener: () => void): unknown;
};

export type ShutdownStep = { name: string; run(): Promise<void> | void };
export type ShutdownOutcome = {
  event: "runtime.shutdown";
  source: "worker" | "realtime" | "core-api";
  status: "drained" | "failed" | "timed_out";
  step: string | null;
  exitCode: 0 | 1;
};

type ShutdownOptions = {
  source: ShutdownOutcome["source"];
  steps: ShutdownStep[];
  timeoutMs: number;
  signals?: SignalSource;
  exit?: (code: 0 | 1) => void;
  report?: (outcome: ShutdownOutcome) => void;
};

/** One bounded shutdown per process; a timeout never claims completed work or retries it. */
export function installSignalShutdown(options: ShutdownOptions) {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    options.timeoutMs > 2_147_483_647
  )
    throw new AppError(
      ERROR_IDS.RUNTIME_SHUTDOWN_CONFIGURATION_INVALID,
      "Shutdown timeout must be a positive integer",
    );
  const signals = options.signals ?? process;
  const exit = options.exit ?? ((code: 0 | 1) => process.exit(code));
  const report = options.report ?? ((outcome) => console.warn(JSON.stringify(outcome)));
  let completion: Promise<ShutdownOutcome> | undefined;

  function dispose(): void {
    signals.off("SIGTERM", onSignal);
    signals.off("SIGINT", onSignal);
  }

  async function execute(): Promise<ShutdownOutcome> {
    let timedOut = false;
    const deadlineAt = performance.now() + options.timeoutMs;
    let step: string | null = null;
    const deadlineExpired = (): boolean => timedOut || performance.now() >= deadlineAt;
    const outcome = (status: ShutdownOutcome["status"]): ShutdownOutcome => ({
      event: "runtime.shutdown",
      source: options.source,
      status,
      step,
      exitCode: status === "drained" ? 0 : 1,
    });
    let resolveDeadline: (value: ShutdownOutcome) => void = () => undefined;
    const deadline = new Promise<ShutdownOutcome>((resolve) => {
      resolveDeadline = resolve;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      resolveDeadline(outcome("timed_out"));
    }, options.timeoutMs);
    const work = (async () => {
      try {
        for (const current of options.steps) {
          // Do not close the pool beneath work that finishes after the deadline.
          if (deadlineExpired()) return outcome("timed_out");
          step = current.name;
          await current.run();
          if (deadlineExpired()) return outcome("timed_out");
        }
        return outcome("drained");
      } catch {
        // Exception messages can contain payloads, SQL or provider credentials.
        return outcome("failed");
      }
    })();
    const result = await Promise.race([work, deadline]);
    clearTimeout(timer);
    dispose();
    try {
      report(result);
    } catch {
      // A failed diagnostics sink must not keep a completed/failed drain alive.
    }
    exit(result.exitCode);
    return result;
  }

  function request(): Promise<ShutdownOutcome> {
    // Set the promise before invoking user code; reentrant or repeated signals share it.
    completion ??= Promise.resolve().then(execute);
    return completion;
  }

  function onSignal(): void {
    void request();
  }

  signals.on("SIGTERM", onSignal);
  signals.on("SIGINT", onSignal);
  return { request, dispose };
}

type QueueRuntime = {
  getWipData(): { name: string }[];
  offWork(name: string, options: { wait: true }): Promise<void>;
  stop(options: { graceful: true; timeout: number }): Promise<void>;
};

/** Track actual product callbacks, not pg-boss's bounded wait for them. */
export function createWorkerCallbackTracker() {
  const pending = new Set<Promise<void>>();
  let installed = false;
  let registrationsClosed = false;
  let consumersStopped = false;
  let lateCallback = false;
  return {
    install(boss: Pick<PgBoss, "work">): void {
      if (installed)
        throw new AppError(
          ERROR_IDS.RUNTIME_TRACKING_ALREADY_INSTALLED,
          "Worker callback tracking was already installed",
        );
      installed = true;
      const original = boss.work;
      const invokeOriginal = (registration: unknown[]): unknown => {
        const result: unknown = Reflect.apply(original, boss, registration);
        return result;
      };
      // Keep the installed overload type at the public boundary. Forward every
      // registration argument unchanged except the final callback, including options.
      boss.work = ((...registration: unknown[]) => {
        if (registrationsClosed)
          return Promise.reject(
            new AppError(
              ERROR_IDS.RUNTIME_REGISTRATION_DURING_DRAIN,
              "Worker registrations are closed during drain",
            ),
          );
        const callback = registration[registration.length - 1];
        if (typeof callback !== "function") return invokeOriginal(registration);
        const tracked = function (this: unknown, ...arguments_: unknown[]) {
          if (consumersStopped) {
            lateCallback = true;
            return Promise.reject(
              new AppError(
                ERROR_IDS.RUNTIME_CALLBACK_AFTER_CONSUMER_STOP,
                "A callback arrived after the consumer-stop barrier",
              ),
            );
          }
          let complete!: () => void;
          const marker = new Promise<void>((resolve) => {
            complete = resolve;
          });
          // Register BEFORE invoking user code, including synchronous throw/reentrance.
          pending.add(marker);
          const settled = () => {
            pending.delete(marker);
            complete();
          };
          try {
            const result: unknown = Reflect.apply(callback, this, arguments_);
            // Bookkeeping observes completion/rejection but returns the original result
            // to pg-boss, preserving its normal settlement and retry semantics.
            void Promise.resolve(result).then(settled, settled);
            return result;
          } catch (error) {
            settled();
            throw error;
          }
        };
        return invokeOriginal([...registration.slice(0, -1), tracked]);
      }) as PgBoss["work"];
    },
    beginDrain(): void {
      if (!installed)
        throw new AppError(
          ERROR_IDS.RUNTIME_TRACKING_MISSING,
          "Worker callback tracking was not installed before registration",
        );
      registrationsClosed = true;
    },
    finishConsumerStop(): void {
      if (!registrationsClosed)
        throw new AppError(
          ERROR_IDS.RUNTIME_CONSUMER_STOP_BEFORE_DRAIN,
          "Consumer stop began before callback tracking drain",
        );
      consumersStopped = true;
    },
    async waitForSettled(): Promise<void> {
      if (!consumersStopped)
        throw new AppError(
          ERROR_IDS.RUNTIME_CALLBACK_WAIT_BEFORE_STOP,
          "Consumer stop must finish before waiting for callbacks",
        );
      while (pending.size > 0) await Promise.all([...pending]);
      if (lateCallback)
        throw new AppError(
          ERROR_IDS.RUNTIME_CALLBACK_AFTER_CONSUMER_STOP,
          "A callback arrived after the consumer-stop barrier",
        );
    },
  };
}

/** Installed pg-boss exposes every non-stopped consumer, including idle ones, via getWipData. */
export function workerShutdownSteps(
  starting: Promise<QueueRuntime>,
  closePool: () => Promise<void>,
  detachProducer: () => void,
  callbacks: ReturnType<typeof createWorkerCallbackTracker>,
): ShutdownStep[] {
  return [
    {
      name: "consumers",
      async run() {
        const boss = await starting;
        callbacks.beginDrain();
        const names = [...new Set(boss.getWipData().map(({ name }) => name))];
        // Issue stop to ALL queues before awaiting any active handler. offWork's wait
        // may stop waiting for an overrun, so actual callback completion is a second gate.
        const results = await Promise.allSettled(
          names.map((name) => boss.offWork(name, { wait: true })),
        );
        // Installed Worker.stop waits its runPromise: even a prefetched batch invokes
        // its callback before that promise settles. Any later invocation is rejected
        // before user code by the tracker as a defensive invariant violation.
        callbacks.finishConsumerStop();
        await callbacks.waitForSettled();
        if (results.some((result) => result.status === "rejected"))
          throw new AppError(
            ERROR_IDS.RUNTIME_CONSUMER_DRAIN_FAILED,
            "A queue consumer did not finish draining",
          );
      },
    },
    {
      name: "queue",
      async run() {
        const boss = await starting;
        detachProducer();
        // Active handlers have already settled. The library's own stop timeout can
        // fail/abort WIP, so it must not be the evidence for a successful job drain.
        await boss.stop({ graceful: true, timeout: 30_000 });
      },
    },
    { name: "database", run: closePool },
  ];
}
