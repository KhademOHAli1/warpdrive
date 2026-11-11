import type { RawData } from "ws";
import { type WebSocket, WebSocketServer } from "ws";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  WS_CAPACITY_CLOSE_GRACE_MS,
  WS_CLOSE_AT_CAPACITY,
  WS_MAX_CONNECTIONS,
  WS_MAX_PAYLOAD_BYTES,
} from "@/constants/wsLimits";
import { PresenceHub } from "./presenceHub";
import { SocketSession, type WsServerDeps } from "./socketSession";

export type { WsServerDeps } from "./socketSession";
export type ManagedWsServer = WebSocketServer & { drain(): Promise<void> };

function rawByteLength(raw: RawData): number {
  return Array.isArray(raw)
    ? raw.reduce((size, fragment) => size + fragment.byteLength, 0)
    : raw.byteLength;
}

// Decode ws RawData (Buffer | ArrayBuffer | Buffer[]) to a UTF-8 string.
function rawToUtf8(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return Buffer.concat(raw).toString("utf8");
}

// Boots the standalone WS process (Compose `ws` service). Auth via the first `auth`
// frame (ops spec A1); subscribes authorized per A2; server-trusted NOTIFY relayed
// per A3. Deps (db + relay) are injected so tests run against a real Postgres
// container without mocking the database.
//
// This listener is publicly reachable: Caddy proxies /_ws straight through, and a TCP connection
// is accepted from anyone before any credential is presented. The two bounds applied here, plus
// the per-socket auth deadline in SocketSession, are what keep that from being free to abuse.
export function startWsServer(port: number, deps: WsServerDeps, host?: string): ManagedWsServer {
  // One PresenceHub per server instance keeps test runs isolated.
  const presenceHub = new PresenceHub();
  const maxConnections = deps.maxConnections ?? WS_MAX_CONNECTIONS;
  const maxPayload = deps.maxPayloadBytes ?? WS_MAX_PAYLOAD_BYTES;

  // Keep the parser limit so `ws` can reject oversize messages during reassembly.
  const wss = new WebSocketServer({ port, host, maxPayload });
  const sessions = new Map<WebSocket, SocketSession>();
  const pendingTeardowns = new Set<Promise<void>>();
  const trackedTeardowns = new WeakMap<SocketSession, Promise<void>>();
  let draining = false;
  let drainPromise: Promise<void> | null = null;

  function teardown(socket: WebSocket, session: SocketSession): Promise<void> {
    const existing = trackedTeardowns.get(session);
    if (existing !== undefined) return existing;
    const cleanup = session.teardown();
    trackedTeardowns.set(session, cleanup);
    pendingTeardowns.add(cleanup);
    void cleanup.then(
      () => {
        sessions.delete(socket);
        pendingTeardowns.delete(cleanup);
      },
      () => {
        sessions.delete(socket);
        pendingTeardowns.delete(cleanup);
        console.warn("ws session teardown failed");
      },
    );
    return cleanup;
  }

  function drain(): Promise<void> {
    if (drainPromise !== null) return drainPromise;
    draining = true;
    // The installed ws close() stops accepting connections but waits for existing
    // peers; close those cooperatively only after their active session work settles.
    const closed = new Promise<void>((resolve, reject) => {
      wss.close((error) => (error ? reject(error) : resolve()));
    });
    void closed.catch(() => undefined);
    for (const [socket, session] of sessions) void teardown(socket, session);
    drainPromise = (async () => {
      const results = await Promise.allSettled([...pendingTeardowns]);
      for (const socket of wss.clients) socket.close(1012, "Service restart");
      await closed;
      if (results.some((result) => result.status === "rejected"))
        throw new AppError(
          ERROR_IDS.RUNTIME_WS_DRAIN_FAILED,
          "WebSocket sessions did not finish draining",
        );
    })();
    return drainPromise;
  }

  wss.on("connection", (socket: WebSocket) => {
    // Installed BEFORE any branch, including the capacity rejection below. A ws socket with no
    // 'error' listener rethrows, and in this standalone process that is an uncaught exception that
    // takes the whole listener down. Enforcing maxPayload is exactly what makes such an error
    // reachable on demand by any unauthenticated peer (WS_ERR_UNSUPPORTED_MESSAGE_LENGTH). The
    // rejected-at-capacity socket is still live during its close handshake and can be pushed an
    // oversize frame in that window, so the handler must already be attached on that path too.
    socket.on("error", () => {
      console.warn("ws socket error; closing");
    });

    if (draining) {
      socket.close(1012, "Service restart");
      return;
    }

    // `clients` already includes this socket, hence a strict "greater than".
    if (wss.clients.size > maxConnections) {
      // 1013 = "try again later", so a cooperating client backs off instead of reconnecting in a
      // tight loop. But close() only sends the frame and waits for the peer's close-ack: a peer
      // that never acks keeps its file descriptor and its slot in wss.clients, so an attacker
      // could hold the connection count past the ceiling and the cap would not actually bound
      // anything. The grace terminate frees the descriptor regardless of the peer's cooperation.
      // (A pre-accept hard ceiling would mean rejecting at the HTTP upgrade; that is a larger
      // change this deliberately does not make, so a brief post-accept window remains.)
      socket.close(WS_CLOSE_AT_CAPACITY);
      const forceClose = setTimeout(() => socket.terminate(), WS_CAPACITY_CLOSE_GRACE_MS);
      forceClose.unref();
      socket.once("close", () => clearTimeout(forceClose));
      return;
    }

    const session = new SocketSession(socket, deps, presenceHub);
    sessions.set(socket, session);
    socket.on("message", (raw) => {
      // Bun can deliver a message past the parser limit. Check bytes before decoding or dispatch.
      if (maxPayload > 0 && rawByteLength(raw) > maxPayload) {
        socket.close(1009);
        return;
      }
      void session.dispatch(rawToUtf8(raw)).catch(() => {
        console.warn("ws session dispatch failed");
      });
    });
    socket.on("close", () => {
      void teardown(socket, session);
    });
  });
  return Object.assign(wss, { drain });
}
