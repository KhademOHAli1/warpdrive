import { once } from "node:events";
import { chmodSync, lstatSync, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { dirname, isAbsolute } from "node:path";
import {
  createOperationsCollectorHandler,
  type OperationsCollectorServices,
} from "./collectorHttp";
import { OPERATIONS_COLLECTOR_HOST, OPERATIONS_COLLECTOR_PATH } from "./collectorSignature";
import { OPERATIONS_MAX_BODY_BYTES } from "./contracts";
import { operationsInvariant } from "./storage";

const socketLifetimeMs = 20_000;
const maxConnections = 16;
const allowed = new Set([
  "host",
  "connection",
  "content-type",
  "content-length",
  "x-warpdrive-collector-source",
  "x-warpdrive-collector-timestamp",
  "x-warpdrive-collector-signature",
]);

function privateSocketParent(path: string): string {
  const parent = dirname(path);
  const info = lstatSync(parent);
  if (
    !isAbsolute(path) ||
    !path.endsWith("/collector.sock") ||
    realpathSync(parent) !== parent ||
    path !== `${parent}/collector.sock` ||
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o7777) !== 0o700
  ) {
    operationsInvariant("An owned private collector socket directory is required");
  }
  return parent;
}

function rawHeaders(message: IncomingMessage): Headers | null {
  const headers = new Headers();
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    const name = message.rawHeaders[index]?.toLowerCase();
    const value = message.rawHeaders[index + 1];
    if (name === undefined || value === undefined || !allowed.has(name) || headers.has(name))
      return null;
    headers.set(name, value);
  }
  if (
    headers.get("host") !== OPERATIONS_COLLECTOR_HOST ||
    (headers.has("connection") && headers.get("connection")?.toLowerCase() !== "close")
  )
    return null;
  return headers;
}

function reject(response: ServerResponse, status: number, error: string): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify({ error }));
}

function requestStream(request: IncomingMessage): ReadableStream<Uint8Array> {
  const chunks = request.iterator({ destroyOnReturn: false });
  return new ReadableStream({
    async pull(controller) {
      const chunk = await chunks.next();
      if (chunk.done === true) controller.close();
      else if (chunk.value instanceof Uint8Array) controller.enqueue(chunk.value);
      else controller.error(new TypeError("Collector body must contain bytes"));
    },
  });
}

async function respond(
  handle: ReturnType<typeof createOperationsCollectorHandler>,
  incoming: IncomingMessage,
  outgoing: ServerResponse,
): Promise<void> {
  const target = incoming.url ?? "";
  const headers = rawHeaders(incoming);
  const length = headers?.get("content-length");
  if (
    incoming.httpVersion !== "1.1" ||
    target !== OPERATIONS_COLLECTOR_PATH ||
    headers === null ||
    length == null ||
    !/^[1-9][0-9]*$/u.test(length)
  ) {
    reject(outgoing, 400, "invalid_request");
    return;
  }
  if (Number(length) > OPERATIONS_MAX_BODY_BYTES) {
    reject(outgoing, 413, "body_too_large");
    return;
  }
  if (incoming.method !== "POST") {
    outgoing.setHeader("Allow", "POST");
    reject(outgoing, 405, "method_not_allowed");
    return;
  }
  const abort = new AbortController();
  const disconnect = () => abort.abort();
  outgoing.once("close", disconnect);
  try {
    const request = new Request(`http://${OPERATIONS_COLLECTOR_HOST}${target}`, {
      method: "POST",
      headers,
      body: requestStream(incoming),
      signal: abort.signal,
      duplex: "half",
    } as RequestInit);
    const result = await handle(request, target);
    const body = await result.text();
    if (outgoing.destroyed) return;
    outgoing.writeHead(result.status, {
      ...Object.fromEntries(result.headers),
      Connection: "close",
    });
    outgoing.end(body);
  } finally {
    outgoing.off("close", disconnect);
  }
}

/** Accept only same-host authenticated batches through a dedicated Unix socket. */
export async function listenOperationsCollector(
  path: string,
  services: OperationsCollectorServices,
) {
  const parent = privateSocketParent(path);
  const parentBefore = lstatSync(parent);
  if (lstatSync(path, { throwIfNoEntry: false }))
    operationsInvariant("Collector socket path is already in use");
  let acceptingWrites = true;
  const writes = new Set<Promise<unknown>>();
  const handle = createOperationsCollectorHandler({
    lookupAuthority: (sourceId) => services.lookupAuthority(sourceId),
    write(binding, body, signal) {
      if (!acceptingWrites) operationsInvariant("Collector is draining");
      const write = services.write(binding, body, signal);
      writes.add(write);
      const settled = () => writes.delete(write);
      void write.then(settled, settled);
      return write;
    },
  });
  const sockets = new Set<Socket>();
  const served = new WeakSet<Socket>();
  const server = createServer(
    { maxHeaderSize: 4_096, headersTimeout: 5_000, requestTimeout: 15_000 },
    (request, response) => {
      if (served.has(request.socket)) {
        request.socket.destroy();
        return;
      }
      served.add(request.socket);
      void respond(handle, request, response).catch(() => {
        if (response.destroyed) return;
        if (response.headersSent) response.destroy();
        else reject(response, 503, "temporarily_unavailable");
      });
    },
  );
  server.maxConnections = maxConnections;
  server.maxRequestsPerSocket = 1;
  server.on("checkContinue", (_request, response) => reject(response, 417, "invalid_request"));
  server.on("checkExpectation", (_request, response) => reject(response, 417, "invalid_request"));
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("connection", (socket) => {
    sockets.add(socket);
    const timer = setTimeout(() => socket.destroy(), socketLifetimeMs);
    timer.unref();
    socket.once("close", () => {
      clearTimeout(timer);
      sockets.delete(socket);
    });
  });
  let close: Promise<void> | undefined;
  const stop = () =>
    (close ??= (async () => {
      acceptingWrites = false;
      const closed = new Promise<void>((resolve, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolve()));
      });
      for (const socket of sockets) socket.destroy();
      await closed;
      await Promise.allSettled(writes);
    })());
  server.listen(path);
  await once(server, "listening");
  try {
    privateSocketParent(path);
    const current = lstatSync(parent);
    const info = lstatSync(path);
    if (
      current.dev !== parentBefore.dev ||
      current.ino !== parentBefore.ino ||
      !info.isSocket() ||
      info.uid !== process.getuid?.()
    )
      operationsInvariant("Collector socket authority changed during startup");
    chmodSync(path, 0o600);
  } catch (error) {
    await stop();
    throw error;
  }
  return { close: stop };
}
