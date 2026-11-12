import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import { isSemver } from "./compareVersions";

export const WEB_IDENTITY_PATH = "/api/runtime/web-identity";
export const webIdentitySchema = z
  .object({
    contract: z.literal("warpdrive.web.identity.v1"),
    component: z.literal("web"),
    version: z
      .string()
      .max(128)
      .refine((value) => value === "dev" || isSemver(value)),
    sourceRevision: z
      .string()
      .regex(/^[a-f0-9]{40}$/u)
      .nullable(),
  })
  .strict();

export type WebIdentity = z.infer<typeof webIdentitySchema>;
export type WebIdentityFailure = "unavailable" | "incompatible" | "timeout" | "aborted" | "closed";
export type ReadWebIdentity = (
  signal?: AbortSignal,
) => Promise<Result<WebIdentity, WebIdentityFailure>>;

/** Process declarations only: image digest/accepted routing still require deployment inspection. */
export function declareWebIdentity(version: string, sourceRevision: string): WebIdentity {
  return webIdentitySchema.parse({
    contract: "warpdrive.web.identity.v1",
    component: "web",
    version,
    sourceRevision: /^[a-f0-9]{40}$/u.test(sourceRevision) ? sourceRevision : null,
  });
}

type ReaderOptions = {
  /** Operator-owned internal origin, never an RPC input or a forwarded credential destination. */
  origin: string;
  timeoutMs: number;
  cacheMs: number;
  fetch?: typeof fetch;
  now?: () => number;
};
type Pending = {
  controller: AbortController;
  result: Promise<Result<WebIdentity, WebIdentityFailure>>;
  work: Promise<void>;
  cleanupUnknown: boolean;
};

const MAX_BYTES = 1024;

function currentlyAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function identityBodyLength(response: Response): number | null | "invalid" {
  // Fetch can expose decoded bytes while retaining the encoded Content-Length.
  // Bound decoded bytes below; compare lengths only when there is no content coding.
  const coding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (coding !== undefined && coding !== "" && coding !== "identity") return null;
  const length = response.headers.get("content-length");
  if (length === null) return null;
  return /^(?:0|[1-9]\d{0,3})$/u.test(length) && Number(length) <= MAX_BYTES
    ? Number(length)
    : "invalid";
}

async function readIdentityBytes(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: number | null,
  interrupted: () => boolean,
  exhausted: () => void,
): Promise<Result<Uint8Array, WebIdentityFailure>> {
  const buffer = new Uint8Array(MAX_BYTES);
  let used = 0;
  for (;;) {
    if (interrupted()) return err("timeout");
    const chunk = await reader.read();
    if (interrupted()) return err("timeout");
    if (chunk.done) {
      exhausted();
      break;
    }
    if (used + chunk.value.byteLength > MAX_BYTES) return err("incompatible");
    buffer.set(chunk.value, used);
    used += chunk.value.byteLength;
  }
  if (expected !== null && expected !== used) return err("incompatible");
  return ok(buffer.subarray(0, used));
}

function parseIdentityBytes(
  bytes: Uint8Array,
  interrupted: () => boolean,
): Result<WebIdentity, WebIdentityFailure> {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const parsed = webIdentitySchema.safeParse(value);
  if (interrupted()) return err("timeout");
  return parsed.success ? ok(parsed.data) : err("incompatible");
}

async function finishIdentityBody(
  body: ReadableStream<Uint8Array> | null,
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
  exhausted: boolean,
  retainOwnership: () => void,
): Promise<void> {
  if (!exhausted) {
    try {
      // A rejected cancellation is not evidence the actual response transport ended.
      await (reader === undefined ? body?.cancel() : reader.cancel());
    } catch {
      retainOwnership();
    }
  }
  try {
    reader?.releaseLock();
  } catch {
    retainOwnership();
  }
}

async function decodeIdentity(
  response: Response,
  signal: AbortSignal,
  timedOut: () => boolean,
  retainOwnership: () => void,
): Promise<Result<WebIdentity, WebIdentityFailure>> {
  const body = response.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let exhausted = body === null;
  const interrupted = () => timedOut() || currentlyAborted(signal);
  try {
    reader = body?.getReader();
    if (interrupted()) return err("timeout");
    if (
      response.status !== 200 ||
      !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "") ||
      reader === undefined
    )
      return err("incompatible");
    const length = identityBodyLength(response);
    if (length === "invalid") return err("incompatible");
    const bytes = await readIdentityBytes(reader, length, interrupted, () => {
      exhausted = true;
    });
    return bytes.ok ? parseIdentityBytes(bytes.value, interrupted) : bytes;
  } catch {
    return err(interrupted() ? "timeout" : "incompatible");
  } finally {
    await finishIdentityBody(body, reader, exhausted, retainOwnership);
  }
}

/** One bounded metadata read in flight; late/abort-ignoring I/O never creates a replacement. */
export function createWebIdentityReader(options: ReaderOptions): {
  read: ReadWebIdentity;
  close(): Promise<void>;
} {
  const origin = new URL(options.origin);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 5000 ||
    !Number.isSafeInteger(options.cacheMs) ||
    options.cacheMs < 0 ||
    options.cacheMs > 5000
  )
    throw new TypeError("Invalid Web identity reader configuration");
  const url = new URL(WEB_IDENTITY_PATH, origin).href;
  const fetchIdentity = options.fetch ?? fetch;
  const now = options.now ?? (() => performance.now());
  let pending: Pending | undefined;
  let closed = false;
  let cached: { result: Result<WebIdentity, WebIdentityFailure>; expires: number } | undefined;

  function begin(): Pending {
    const controller = new AbortController();
    const deadline = now() + options.timeoutMs;
    let expired = false;
    let finish: (value: Result<WebIdentity, WebIdentityFailure>) => void = () => undefined;
    const result = new Promise<Result<WebIdentity, WebIdentityFailure>>((resolve) => {
      finish = resolve;
    });
    const expire = () => {
      expired = true;
      controller.abort();
      finish(err("timeout"));
    };
    const timedOut = () => {
      // Buffered reads can continuously settle as microtasks and delay the timer callback.
      if (!expired && now() >= deadline) expire();
      return expired;
    };
    const timer = setTimeout(expire, options.timeoutMs);
    const owned: Pending = { controller, result, work: Promise.resolve(), cleanupUnknown: false };
    pending = owned;
    owned.work = Promise.resolve()
      .then(async () => {
        let value: Result<WebIdentity, WebIdentityFailure>;
        try {
          const response = await fetchIdentity(url, {
            method: "GET",
            redirect: "error",
            cache: "no-store",
            credentials: "omit",
            headers: { accept: "application/json" },
            signal: controller.signal,
          });
          value = await decodeIdentity(response, controller.signal, timedOut, () => {
            owned.cleanupUnknown = true;
          });
        } catch {
          value = err(
            timedOut() || currentlyAborted(controller.signal) ? "timeout" : "unavailable",
          );
        }
        if (timedOut()) value = err("timeout");
        if (closed) value = err("closed");
        cached = { result: value, expires: now() + options.cacheMs };
        finish(value);
      })
      .finally(() => {
        clearTimeout(timer);
        if (pending === owned && !owned.cleanupUnknown) pending = undefined;
      });
    return owned;
  }

  return {
    async read(signal) {
      if (closed) return err("closed");
      if (currentlyAborted(signal)) return err("aborted");
      const stored = cached;
      if (stored !== undefined && now() < stored.expires) return stored.result;
      const active = pending ?? begin();
      if (signal === undefined) return active.result;
      return new Promise((resolve) => {
        const onAbort = () => resolve(err("aborted"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (currentlyAborted(signal)) onAbort();
        void active.result.then((value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        });
      });
    },
    async close() {
      closed = true;
      cached = undefined;
      const owned = pending;
      owned?.controller.abort();
      // Retain ownership through real settlement, including abort-ignoring transports.
      await owned?.work;
      if (owned?.cleanupUnknown === true)
        throw new AppError(
          ERROR_IDS.RUNTIME_CORE_API_STREAM_UNSETTLED,
          "Web identity transport cleanup incomplete",
        );
    },
  };
}
