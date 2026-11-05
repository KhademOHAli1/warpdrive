import * as http from "node:http";
import * as https from "node:https";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

const STORAGE_DEADLINE_MS = 10_000;
const storageError = (cause: unknown): Error =>
  cause instanceof Error
    ? cause
    : new AppError(ERROR_IDS.COMPANY_STORAGE_UNAVAILABLE, "Company storage request failed");
/** A late immutable PUT may leave an unreferenced object, never an approved pointer. */
export function companyStorageCall<T>(
  signal: AbortSignal,
  operation: () => Promise<T>,
  disposeLate?: (value: T) => void,
  timeoutMs = STORAGE_DEADLINE_MS,
): Promise<T> {
  signal.throwIfAborted();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (!settled) {
        settled = true;
        reject(storageError(deadline.reason));
      }
    };
    deadline.addEventListener("abort", abort, { once: true });
    const cleanup = () => deadline.removeEventListener("abort", abort);
    try {
      void operation()
        .then(
          (value) => {
            cleanup();
            if (settled) {
              disposeLate?.(value);
              return;
            }
            settled = true;
            resolve(value);
          },
          (cause: unknown) => {
            cleanup();
            if (!settled) {
              settled = true;
              reject(storageError(cause));
            }
          },
        )
        .catch(() => {
          /* Late transport/disposal failures are consumed after the caller deadline. */
        });
    } catch (cause) {
      cleanup();
      settled = true;
      reject(storageError(cause));
    }
  });
}

/** SDK requests also destroy their socket on inactivity; retries cannot extend this bound. */
export function companyStorageTransport(secure: boolean) {
  const transport = secure ? https : http;
  type Callback = (response: http.IncomingMessage) => void;
  const request: typeof http.request = (
    input: string | URL | http.RequestOptions,
    options?: http.RequestOptions | Callback,
    callback?: Callback,
  ) => {
    const req =
      typeof input === "string" || input instanceof URL
        ? typeof options === "function" || options === undefined
          ? transport.request(input, options)
          : transport.request(input, options, callback)
        : transport.request(input, typeof options === "function" ? options : callback);
    req.setTimeout(STORAGE_DEADLINE_MS, () => req.destroy());
    return req;
  };
  return { request };
}
