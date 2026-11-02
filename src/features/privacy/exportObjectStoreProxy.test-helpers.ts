import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { deferred } from "./exportArchiveTestKit";

export async function startStorageProxy(
  target: string,
  mode: "hold_part" | "hold_complete" | "hold_head" | "drop_complete" | "drop_delete",
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const upstream = new URL(target);
  const reached = deferred<void>();
  const released = deferred<void>();
  const disconnected = deferred<void>();
  let partRequests = 0;
  let completeRequests = 0;
  let deleteRequests = 0;
  let droppedResponses = 0;
  const server = createServer((incoming, outgoing) => {
    const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
    const part = incoming.method === "PUT" && url.searchParams.has("partNumber");
    const complete = incoming.method === "POST" && url.searchParams.has("uploadId");
    const head = incoming.method === "HEAD" && url.searchParams.has("versionId");
    const deletion = incoming.method === "DELETE" && url.searchParams.has("versionId");
    if (part) partRequests++;
    if (complete) completeRequests++;
    if (deletion) deleteRequests++;
    const forward = () => {
      if (outgoing.destroyed) return;
      const operation = request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: incoming.url,
          method: incoming.method,
          headers: incoming.headers,
          signal,
        },
        (response) => {
          if (
            ((mode === "drop_complete" && complete) || (mode === "drop_delete" && deletion)) &&
            response.statusCode !== undefined &&
            response.statusCode < 300
          ) {
            droppedResponses++;
            outgoing.socket?.destroy();
            outgoing.destroy();
            response.resume();
            return;
          }
          outgoing.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(outgoing);
        },
      );
      operation.once("error", () => outgoing.destroy());
      incoming.once("aborted", () => operation.destroy());
      outgoing.once("close", () => {
        if (!outgoing.writableFinished) operation.destroy();
      });
      incoming.pipe(operation);
    };
    if (
      (mode === "hold_part" && part) ||
      (mode === "hold_complete" && complete) ||
      (mode === "hold_head" && head)
    ) {
      reached.resolve();
      outgoing.once("close", () => disconnected.resolve());
      void released.promise.then(forward);
    } else forward();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address !== "string", "synthetic_proxy_address");
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= new Promise<void>((resolve, reject) => {
      released.resolve();
      server.closeAllConnections();
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((cause) => (cause === undefined ? resolve() : reject(cause)));
    }).finally(() => signal.removeEventListener("abort", abort));
    return closing;
  };
  const abort = () => {
    void close().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) {
    await close();
    signal.throwIfAborted();
  }
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    reached: reached.promise,
    disconnected: disconnected.promise,
    release: () => released.resolve(),
    counts: () => ({ partRequests, completeRequests, deleteRequests, droppedResponses }),
    close,
  };
}
