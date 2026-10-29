import { describe, expect, it, vi } from "vitest";
import { type WsFrame, WsMultiplexer } from "./wsMultiplexer";

// Minimal WebSocket stand-in the multiplexer drives via onopen/onmessage/onclose.
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];
  closed = false;
  readyState: number = WebSocket.CONNECTING;
  send(s: string): void {
    if (this.readyState === WebSocket.CONNECTING)
      throw new DOMException("WebSocket is still connecting", "InvalidStateError");
    if (this.readyState === WebSocket.OPEN) this.sent.push(s);
  }
  close(): void {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }
  deliver(frame: object): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  sentKinds(): string[] {
    return this.sent.map((s) => (JSON.parse(s) as { kind: string }).kind);
  }
  subscribedChannels(): string[] {
    return this.sent
      .map((s) => JSON.parse(s) as { kind: string; channel?: string })
      .filter((m) => m.kind === "subscribe")
      .map((m) => m.channel ?? "");
  }
}

function setup(url = "ws://x") {
  const sockets: FakeSocket[] = [];
  const makeSocket = (): WebSocket => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as WebSocket;
  };
  const mintTicket = vi.fn(() => Promise.resolve("ticket-1"));
  const mux = new WsMultiplexer(url, mintTicket, makeSocket);
  return { mux, sockets, mintTicket };
}

// Await the microtask where connect()'s awaited mintTicket resolves and the socket is created.
const flush = (): Promise<void> => Promise.resolve().then(() => undefined);

function deferredTicket() {
  let resolve: (ticket: string) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<string>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return {
    promise,
    resolve: (ticket: string) => resolve(ticket),
    reject: (reason?: unknown) => reject(reason),
  };
}

describe("WsMultiplexer", () => {
  it("mints one ticket and opens one socket for multiple channels", async () => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("pipeline:p1", vi.fn());
    mux.subscribe("user:u1", vi.fn());
    await flush();
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  it("auths then subscribes every live channel on auth_ok", async () => {
    const { mux, sockets } = setup();
    mux.subscribe("pipeline:p1", vi.fn());
    mux.subscribe("user:u1", vi.fn());
    await flush();
    const sock = sockets[0]!;
    sock.open();
    expect(sock.sentKinds()[0]).toBe("auth");
    sock.deliver({ kind: "auth_ok" });
    expect(sock.subscribedChannels().sort()).toEqual(["pipeline:p1", "user:u1"]);
  });

  it("routes an event frame to only the matching channel's handler", async () => {
    const { mux, sockets } = setup();
    const board = vi.fn();
    const notif = vi.fn();
    mux.subscribe("pipeline:p1", board);
    mux.subscribe("user:u1", notif);
    await flush();
    const sock = sockets[0]!;
    sock.open();
    sock.deliver({ kind: "auth_ok" });

    sock.deliver({ kind: "event", channel: "pipeline:p1", event: { seq: 0, type: "x", data: {} } });
    expect(board).toHaveBeenCalledTimes(1);
    expect(notif).not.toHaveBeenCalled();
  });

  it("subscribes a channel added after auth without a new socket", async () => {
    const { mux, sockets } = setup();
    mux.subscribe("pipeline:p1", vi.fn());
    await flush();
    const sock = sockets[0]!;
    sock.open();
    sock.deliver({ kind: "auth_ok" });

    mux.subscribe("user:u1", vi.fn());
    expect(sockets).toHaveLength(1);
    expect(sock.subscribedChannels()).toContain("user:u1");
  });

  it("closes the socket once the last handler unsubscribes", async () => {
    const { mux, sockets } = setup();
    const unsub = mux.subscribe("pipeline:p1", vi.fn());
    await flush();
    const sock = sockets[0]!;
    sock.open();
    sock.deliver({ kind: "auth_ok" });
    unsub();
    expect(sock.closed).toBe(true);
  });

  it("notifies live handlers with a reconnect frame when the socket drops", async () => {
    const { mux, sockets } = setup();
    const board = vi.fn();
    mux.subscribe("pipeline:p1", board);
    await flush();
    const sock = sockets[0]!;
    sock.open();
    sock.deliver({ kind: "auth_ok" });
    board.mockClear();

    sock.close();
    expect(board).toHaveBeenCalledWith({ kind: "reconnect" } satisfies WsFrame);
  });

  it("revives every live channel when a new subscriber mounts after a real connection drop", async () => {
    const { mux, sockets, mintTicket } = setup();
    const board = vi.fn();
    mux.subscribe("pipeline:p1", board);
    mux.subscribe("user:u1", vi.fn());
    await flush();
    const first = sockets[0]!;
    first.open();
    first.deliver({ kind: "auth_ok" });
    first.close();
    await flush();
    expect(mintTicket).toHaveBeenCalledTimes(1);

    mux.subscribe("presence:d1", vi.fn());
    await flush();
    const current = sockets[1]!;
    current.open();
    current.deliver({ kind: "auth_ok" });
    expect(current.subscribedChannels().sort()).toEqual(["pipeline:p1", "presence:d1", "user:u1"]);
    board.mockClear();
    const event = { kind: "event", channel: "pipeline:p1", event: { seq: 1, type: "x", data: {} } };
    current.deliver(event);
    expect(board).toHaveBeenCalledExactlyOnceWith(event);
  });

  it("never connects when the url is empty (realtime disabled / jsdom)", async () => {
    const { mux, sockets, mintTicket } = setup("");
    mux.subscribe("pipeline:p1", vi.fn());
    await flush();
    expect(mintTicket).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(0);
  });

  it("ignores queued auth messages from a replaced socket while its replacement connects", async () => {
    const { mux, sockets } = setup();
    const unsubscribe = mux.subscribe("pipeline:old", vi.fn());
    await flush();
    const oldSocket = sockets[0]!;
    oldSocket.open();
    const queuedMessage = oldSocket.onmessage;
    unsubscribe();

    const handler = vi.fn();
    mux.subscribe("pipeline:new", handler);
    await flush();
    const current = sockets[1]!;
    expect(current.readyState).toBe(WebSocket.CONNECTING);
    expect(() => queuedMessage?.({ data: JSON.stringify({ kind: "auth_ok" }) })).not.toThrow();
    expect(current.sent).toEqual([]);
    queuedMessage?.({ data: JSON.stringify({ kind: "reconnect" }) });
    expect(handler).not.toHaveBeenCalled();

    current.open();
    current.deliver({ kind: "auth_ok" });
    expect(current.sentKinds()).toEqual(["auth", "subscribe"]);
    expect(current.subscribedChannels()).toEqual(["pipeline:new"]);
  });

  it("does not clear a replacement connection when an old close callback was already queued", async () => {
    const { mux, sockets, mintTicket } = setup();
    const unsubscribe = mux.subscribe("pipeline:old", vi.fn());
    await flush();
    const oldSocket = sockets[0]!;
    oldSocket.open();
    const queuedClose = oldSocket.onclose;
    unsubscribe();

    const handler = vi.fn();
    mux.subscribe("pipeline:new", handler);
    await flush();
    const current = sockets[1]!;
    current.open();
    current.deliver({ kind: "auth_ok" });
    queuedClose?.();
    expect(handler).not.toHaveBeenCalled();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    expect(mintTicket).toHaveBeenCalledTimes(2);
    expect(current.subscribedChannels()).toEqual(["pipeline:new", "user:u1"]);
  });

  it("ignores a ticket that resolves after its last subscriber left and a replacement connected", async () => {
    const { mux, sockets, mintTicket } = setup();
    const oldTicket = deferredTicket();
    const currentTicket = deferredTicket();
    mintTicket.mockReturnValueOnce(oldTicket.promise).mockReturnValueOnce(currentTicket.promise);
    const unsubscribe = mux.subscribe("pipeline:old", vi.fn());
    unsubscribe();
    mux.subscribe("pipeline:new", vi.fn());
    currentTicket.resolve("current-ticket");
    await flush();
    expect(sockets).toHaveLength(1);

    oldTicket.resolve("old-ticket");
    await flush();
    expect(sockets).toHaveLength(1);
    const current = sockets[0]!;
    current.open();
    expect(JSON.parse(current.sent[0] ?? "{}")).toEqual({ kind: "auth", ticket: "current-ticket" });
    current.deliver({ kind: "auth_ok" });
    expect(current.subscribedChannels()).toEqual(["pipeline:new"]);
  });

  it("ignores ticket failures from an abandoned attempt without disturbing current subscribers", async () => {
    const { mux, sockets, mintTicket } = setup();
    const oldTicket = deferredTicket();
    mintTicket.mockReturnValueOnce(oldTicket.promise);
    const unsubscribe = mux.subscribe("pipeline:old", vi.fn());
    unsubscribe();
    const handler = vi.fn();
    mux.subscribe("pipeline:new", handler);
    await flush();
    const current = sockets[0]!;
    current.open();
    current.deliver({ kind: "auth_ok" });

    oldTicket.reject(new Error("abandoned ticket request failed"));
    await flush();
    expect(handler).not.toHaveBeenCalled();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    expect(mintTicket).toHaveBeenCalledTimes(2);
    expect(current.subscribedChannels()).toEqual(["pipeline:new", "user:u1"]);
  });
});
