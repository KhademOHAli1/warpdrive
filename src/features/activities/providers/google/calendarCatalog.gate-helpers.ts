import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { deferredValue } from "./accountTestHelpers";
import type { GoogleTransport } from "./contracts";

async function waitForGate<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error
          ? reason
          : new AppError(ERROR_IDS.DB_INVARIANT, "catalog exchange gate aborted"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

export async function whileProviderBlocked<T>(
  start: (transport: GoogleTransport, signal: AbortSignal) => Promise<T>,
  upstream: GoogleTransport,
  during: () => Promise<void>,
  match: (url: string) => boolean = (url) => url.includes("/calendar/v3/"),
): Promise<T> {
  const began = deferredValue<void>();
  const release = deferredValue<void>();
  const deadline = AbortSignal.timeout(3_000);
  const running = start(async (url, init) => {
    if (match(url)) {
      began.resolve();
      await waitForGate(release.promise, init.signal);
    }
    init.signal.throwIfAborted();
    return upstream(url, init);
  }, deadline);
  try {
    await waitForGate(
      Promise.race([
        began.promise,
        running.then(() => {
          throw new AppError(ERROR_IDS.DB_INVARIANT, "operation missed synthetic provider gate");
        }),
      ]),
      deadline,
    );
    await during();
  } finally {
    release.resolve();
    await running.catch(() => undefined);
  }
  return running;
}
