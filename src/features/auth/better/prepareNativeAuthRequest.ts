import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";

// Match the existing finite 64mb application transport envelope in next.config.ts.
// The API is excluded from Next's page proxy; Caddy's outer ceiling is 80MB.
// Preserve supported JSON, URL-encoded, multipart and other native formats as raw bytes.
export const NATIVE_AUTH_BODY_MAX_BYTES = 64 * 1024 * 1024;
export const NATIVE_AUTH_BODY_TIMEOUT_MS = 5_000;
type IngressStatus = 400 | 408 | 413;

interface IngressState {
  failure: IngressStatus | null;
  cancellation: Promise<void> | null;
  cancellationFailed: boolean;
}

async function readChunks(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: IngressState,
  maxBytes: number,
  cancel: (status: IngressStatus) => void,
) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const failed = () => state.failure !== null;
  while (!failed()) {
    const chunk = await reader.read();
    if (failed() || chunk.done) break;
    size += chunk.value.byteLength;
    if (size > maxBytes) {
      cancel(413);
      break;
    }
    // Own each chunk before another controlled pull can reuse an ingress buffer.
    chunks.push(new Uint8Array(chunk.value));
  }
  return { chunks, size };
}

async function readIngress(
  request: Request,
  signal: AbortSignal,
  limits: { maxBytes: number; timeoutMs: number },
): Promise<Result<{ chunks: Uint8Array[]; size: number }, IngressStatus>> {
  const stream = request.body;
  if (stream === null) return err(400);
  const reader = stream.getReader();
  const state: IngressState = { failure: null, cancellation: null, cancellationFailed: false };
  const cancel = (status: IngressStatus) => {
    state.failure ??= status;
    state.cancellation ??= reader.cancel().then(
      () => undefined,
      () => {
        state.cancellationFailed = true;
      },
    );
  };
  const aborted = () => cancel(408);
  const timer = setTimeout(aborted, limits.timeoutMs);
  signal.addEventListener("abort", aborted, { once: true });
  request.signal.addEventListener("abort", aborted, { once: true });
  let body: { chunks: Uint8Array[]; size: number } | null = null;
  try {
    if (signal.aborted || request.signal.aborted) cancel(408);
    const length = request.headers.get("content-length");
    if (length !== null && /^\d+$/.test(length) && Number(length) > limits.maxBytes) cancel(413);
    body = await readChunks(reader, state, limits.maxBytes, cancel);
  } catch {
    // A rejected read is already terminal; unlike cancellation, there is no pending read.
    state.failure ??= 400;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", aborted);
    request.signal.removeEventListener("abort", aborted);
    // cancel() settles a pending read. Await underlying cancellation too, never abandon it.
    if (state.cancellation !== null) await state.cancellation;
    reader.releaseLock();
  }
  if (state.cancellationFailed)
    throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "native body cancellation failed", {});
  if (state.failure !== null) return err(state.failure);
  if (signal.aborted || request.signal.aborted) return err(408);
  return body === null ? err(400) : ok(body);
}

/** Finish or cancel untrusted ingress BEFORE reserving a database client or authority fence. */
export async function prepareNativeAuthRequest(
  request: Request,
  signal: AbortSignal,
  limits = { maxBytes: NATIVE_AUTH_BODY_MAX_BYTES, timeoutMs: NATIVE_AUTH_BODY_TIMEOUT_MS },
): Promise<Result<Request, IngressStatus>> {
  if (request.body === null)
    return signal.aborted || request.signal.aborted ? err(408) : ok(request);
  if (request.bodyUsed || request.body.locked) return err(400);
  const body = await readIngress(request, signal, limits);
  if (!body.ok) return body;
  const bytes = new Uint8Array(body.value.size);
  let offset = 0;
  for (const chunk of body.value.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bytes,
      signal: request.signal,
      credentials: request.credentials,
      cache: request.cache,
      redirect: request.redirect,
      mode: request.mode,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
    }),
  );
}
