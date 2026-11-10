import { err, ok, type Result } from "@/types/result";
import { jsonResourceInput } from "./jsonResourceIngress";

export type McpIngressError = "invalid_request" | "invalid_target";
const MAXIMUM_BODY_BYTES = 32 * 1_024;

function fieldsInput(
  fields: URLSearchParams | FormData,
): Result<Record<string, unknown>, McpIngressError> {
  const resources = fields.getAll("resource");
  if (resources.length !== 1 || typeof resources[0] !== "string" || resources[0].length === 0) {
    return err("invalid_target");
  }
  return ok(Object.fromEntries<unknown>(fields));
}

export function authorizationInput(
  params: URLSearchParams,
): Result<Record<string, unknown>, McpIngressError> {
  return fieldsInput(params);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function withSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve the opaque abort reason.
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  try {
    await withSignal(reader.cancel(), signal);
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
  }
}

async function readBoundedBody(
  request: Request,
  signal: AbortSignal,
): Promise<Result<Uint8Array<ArrayBuffer>, McpIngressError>> {
  signal.throwIfAborted();
  if (request.body === null || request.body.locked || request.bodyUsed)
    return err("invalid_request");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let done = false;
  try {
    const declaredLength = Number(request.headers.get("content-length"));
    if (declaredLength > MAXIMUM_BODY_BYTES) return err("invalid_request");
    for (;;) {
      const chunk = await withSignal(reader.read(), signal);
      signal.throwIfAborted();
      if (chunk.done) {
        done = true;
        break;
      }
      length += chunk.value.byteLength;
      if (length > MAXIMUM_BODY_BYTES) return err("invalid_request");
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return ok(bytes);
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    return err("invalid_request");
  } finally {
    try {
      if (!done) await cancelReader(reader, signal);
    } finally {
      reader.releaseLock();
    }
  }
}

function urlencodedInput(text: string): Result<Record<string, unknown>, McpIngressError> {
  const params = new URLSearchParams();
  try {
    for (const field of text.split("&")) {
      if (field.length === 0) continue;
      const separator = field.indexOf("=");
      const name = separator < 0 ? field : field.slice(0, separator);
      const value = separator < 0 ? "" : field.slice(separator + 1);
      params.append(
        decodeURIComponent(name.replaceAll("+", " ")),
        decodeURIComponent(value.replaceAll("+", " ")),
      );
    }
  } catch {
    return err("invalid_request");
  }
  return fieldsInput(params);
}

export async function readTokenInput(
  request: Request,
  signal: AbortSignal,
): Promise<Result<unknown, McpIngressError>> {
  signal.throwIfAborted();
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (
    !["application/json", "application/x-www-form-urlencoded", "multipart/form-data"].includes(
      mediaType ?? "",
    )
  ) {
    return err("invalid_request");
  }
  const body = await readBoundedBody(request, signal);
  signal.throwIfAborted();
  if (!body.ok) return body;
  try {
    if (mediaType === "multipart/form-data") {
      // Native multipart parsing retains binary unknown fields, after the raw byte bound.
      const bounded = new Request("https://oauth.invalid/token", {
        method: "POST",
        headers: { "content-type": contentType },
        body: body.value,
        signal,
      });
      const fields = await withSignal(bounded.formData(), signal);
      signal.throwIfAborted();
      return fieldsInput(fields);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body.value);
    return mediaType === "application/json" ? jsonResourceInput(text) : urlencodedInput(text);
  } catch (error) {
    signal.throwIfAborted();
    if (isAbortError(error)) throw error;
    return err("invalid_request");
  }
}
