import { err, ok, type Result } from "@/types/result";
import { withMailboxRequestSignal } from "./mailConnectionHttpSignal";

export const MAIL_CONNECTION_MAX_BODY_BYTES = 32 * 1024;

export async function readMailboxRequestBody(
  request: Request,
  signal: AbortSignal,
): Promise<Result<unknown, "invalid_input">> {
  signal.throwIfAborted();
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAIL_CONNECTION_MAX_BODY_BYTES)
  ) {
    if (request.body !== null) void request.body.cancel().catch(() => {});
    return err("invalid_input");
  }
  if (request.body === null) return err("invalid_input");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await withMailboxRequestSignal(reader.read(), signal);
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAIL_CONNECTION_MAX_BODY_BYTES) return err("invalid_input");
      chunks.push(next.value);
    }
    const raw: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
    return ok(raw);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    return err("invalid_input");
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
