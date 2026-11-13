import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketAuthorizationDenied, type TicketMinter, WsMultiplexer } from "./wsMultiplexer";

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: string[] = [];
  closed = false;
  holdClose = false;
  throwSend = false;
  beforeSend: (() => void) | null = null;
  readyState: number = WebSocket.CONNECTING;
  send(s: string): void {
    this.beforeSend?.();
    if (this.throwSend || this.readyState !== WebSocket.OPEN) throw new Error("send failed");
    this.sent.push(s);
  }
  close(): void {
    this.closed = true;
    this.readyState = this.holdClose ? WebSocket.CLOSING : WebSocket.CLOSED;
    if (!this.holdClose) this.onclose?.();
  }
  finishClose(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.();
  }
  open(): void {
    this.readyState = WebSocket.OPEN;
    this.onopen?.();
  }
  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  frames(): { kind: string; channel?: string; ticket?: string }[] {
    return this.sent.map((s) => JSON.parse(s) as { kind: string });
  }
  subscribedChannels(): string[] {
    return this.frames()
      .filter((m) => m.kind === "subscribe")
      .map((m) => m.channel ?? "");
  }
}

function setup(url = "ws://x") {
  const sockets: FakeSocket[] = [];
  const makeSocket = vi.fn((): WebSocket => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  });
  let ticket = 0;
  const mintTicket = vi.fn<TicketMinter>(() => Promise.resolve(`ticket-${++ticket}`));
  const mux = new WsMultiplexer(url, mintTicket, makeSocket);
  return { mux, sockets, mintTicket, makeSocket };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

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

function authenticate(socket: FakeSocket): void {
  socket.open();
  socket.deliver({ kind: "auth_ok" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Math, "random").mockReturnValue(0);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("WsMultiplexer", () => {
  it("does no work without subscribers or with realtime disabled", async () => {
    const idle = setup();
    const disabled = setup("");
    disabled.mux.subscribe("pipeline:p1", vi.fn());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(idle.mintTicket).not.toHaveBeenCalled();
    expect(disabled.mintTicket).not.toHaveBeenCalled();
    expect(disabled.sockets).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("owns one ticket/socket and subscribes current distinct channels only after auth", async () => {
    const { mux, sockets, mintTicket } = setup();
    const removeOld = mux.subscribe("pipeline:old", vi.fn());
    mux.subscribe("user:u1", vi.fn());
    removeOld();
    mux.subscribe("pipeline:new", vi.fn());
    await flush();
    const socket = sockets[0]!;
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    socket.deliver({ kind: "auth_ok" }); // Not yet open/authenticating.
    expect(socket.sent).toEqual([]);
    authenticate(socket);
    socket.deliver({ kind: "auth_ok" }); // Duplicate authentication cannot resubscribe.
    mux.subscribe("user:u1", vi.fn());
    expect(socket.frames()[0]).toEqual({ kind: "auth", ticket: "ticket-1" });
    expect(socket.subscribedChannels()).toEqual(["user:u1", "pipeline:new"]);
  });

  it("routes channel events and emits one channel resync only on its actual ACK", async () => {
    const { mux, sockets } = setup();
    const board = vi.fn();
    const bell = vi.fn();
    mux.subscribe("pipeline:p1", board);
    mux.subscribe("user:u1", bell);
    await flush();
    const socket = sockets[0]!;
    authenticate(socket);
    expect(board).not.toHaveBeenCalled();
    const event = { kind: "event", channel: "pipeline:p1", event: { seq: 0, type: "x", data: {} } };
    socket.deliver(event);
    socket.deliver({ kind: "subscribed", channel: "pipeline:p1" });
    socket.deliver({ kind: "subscribed", channel: "pipeline:p1" });
    expect(board.mock.calls.map(([frame]) => frame.kind)).toEqual([
      "event",
      "resync",
      "subscribed",
    ]);
    expect(board).toHaveBeenCalledWith({ kind: "resync", channel: "pipeline:p1" });
    expect(bell).not.toHaveBeenCalled();
    socket.deliver({ kind: "subscribed", channel: "user:u1" });
    expect(bell.mock.calls.map(([frame]) => frame.kind)).toEqual(["resync", "subscribed"]);
  });

  it("recovers already-mounted channels on a timer with a fresh ticket each time", async () => {
    const { mux, sockets, mintTicket } = setup();
    const board = vi.fn();
    mux.subscribe("pipeline:p1", board);
    mux.subscribe("user:u1", vi.fn());
    await flush();
    authenticate(sockets[0]!);
    sockets[0]!.close();
    expect(board).toHaveBeenCalledExactlyOnceWith({ kind: "reconnect" });
    await vi.advanceTimersByTimeAsync(499);
    expect(mintTicket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const current = sockets[1]!;
    authenticate(current);
    expect(current.frames()[0]).toEqual({ kind: "auth", ticket: "ticket-2" });
    expect(current.subscribedChannels()).toEqual(["pipeline:p1", "user:u1"]);
    expect(board).toHaveBeenCalledTimes(1);
    current.deliver({ kind: "subscribed", channel: "pipeline:p1" });
    expect(board).toHaveBeenCalledWith({ kind: "resync", channel: "pipeline:p1" });
  });

  it("deduplicates error/close failures and caps jittered backoff without repeated outage refetches", async () => {
    const { mux, sockets, mintTicket } = setup();
    const handler = vi.fn();
    mux.subscribe("user:u1", handler);
    await flush();
    const delays = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000];
    for (const delay of delays) {
      const socket = sockets.at(-1)!;
      const queuedClose = socket.onclose;
      socket.onerror?.();
      queuedClose?.();
      const count = mintTicket.mock.calls.length;
      expect(vi.getTimerCount()).toBe(1);
      mux.subscribe("user:u1", vi.fn()); // Mounts cannot bypass backoff.
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(mintTicket).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1);
      expect(mintTicket).toHaveBeenCalledTimes(count + 1);
    }
    expect(handler).toHaveBeenCalledExactlyOnceWith({ kind: "reconnect" });
  });

  it("resets backoff only after ACK-complete stability, not open/auth or brief recovery", async () => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    sockets[0]!.close();
    await vi.advanceTimersByTimeAsync(500);
    authenticate(sockets[1]!);
    sockets[1]!.deliver({ kind: "subscribed", channel: "user:u1" });
    sockets[1]!.close();
    await vi.advanceTimersByTimeAsync(999);
    expect(mintTicket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    authenticate(sockets[2]!);
    sockets[2]!.deliver({ kind: "subscribed", channel: "user:u1" });
    await vi.advanceTimersByTimeAsync(30_000);
    sockets[2]!.close();
    await vi.advanceTimersByTimeAsync(500);
    expect(mintTicket).toHaveBeenCalledTimes(4);
  });

  it.each(["connect", "auth", "subscription"])("bounds a stalled %s phase", async (phase) => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    const socket = sockets[0]!;
    if (phase !== "connect") socket.open();
    if (phase === "subscription") socket.deliver({ kind: "auth_ok" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(mintTicket).toHaveBeenCalledTimes(2);
  });

  it("aborts a hung mint and never accumulates requests even when abort is ignored", async () => {
    const { mux, sockets, mintTicket } = setup();
    const pending = deferredTicket();
    mintTicket.mockReturnValueOnce(pending.promise);
    mux.subscribe("user:u1", vi.fn());
    const signal = mintTicket.mock.calls[0]![0];
    await vi.advanceTimersByTimeAsync(120_000);
    expect(signal.aborted).toBe(true);
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(0);
    pending.resolve("expired-ticket");
    await flush();
    expect(mintTicket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    authenticate(sockets[0]!);
    expect(sockets[0]!.frames()[0]!.ticket).toBe("ticket-1");
  });

  it("waits for actual browser close rather than accumulating CLOSING sockets", async () => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    const old = sockets[0]!;
    old.holdClose = true;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(old.readyState).toBe(WebSocket.CLOSING);
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    old.finishClose();
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it("stops retrying confirmed ticket authorization refusals until a fresh mount lifecycle", async () => {
    const { mux, mintTicket, sockets } = setup();
    mintTicket.mockRejectedValueOnce(new TicketAuthorizationDenied());
    const remove = mux.subscribe("user:u1", vi.fn());
    await vi.advanceTimersByTimeAsync(120_000);
    mux.subscribe("other", vi.fn())();
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    remove();
    mux.subscribe("user:u2", vi.fn());
    await flush();
    expect(mintTicket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
  });

  it.each(["", undefined, null, 42])(
    "never authenticates a malformed successful ticket %s",
    async (ticket) => {
      const { mux, mintTicket, sockets } = setup();
      mintTicket.mockResolvedValueOnce(ticket as string);
      mux.subscribe("user:u1", vi.fn());
      await flush();
      expect(sockets).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(1);
    },
  );

  it("handles socket factory and send throws through the same bounded recovery path", async () => {
    const { mux, sockets, mintTicket, makeSocket } = setup();
    makeSocket.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    mux.subscribe("user:u1", vi.fn());
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    const socket = sockets[0]!;
    socket.open();
    socket.throwSend = true;
    socket.deliver({ kind: "auth_ok" }); // subscribe was recorded before send throws.
    expect(socket.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    authenticate(sockets[1]!);
    expect(mintTicket).toHaveBeenCalledTimes(3);
    expect(sockets[1]!.subscribedChannels()).toEqual(["user:u1"]);
  });

  it("counts a synchronous close followed by a send throw as one failed generation", async () => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    const socket = sockets[0]!;
    socket.beforeSend = () => socket.close();
    socket.throwSend = true;
    socket.open();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(mintTicket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
  });

  it("does not reconnect other channels for a subscription denial or removed pending channel", async () => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("user:u1", vi.fn());
    const deniedHandler = vi.fn();
    mux.subscribe("forbidden", deniedHandler);
    const remove = mux.subscribe("removed", vi.fn());
    await flush();
    const socket = sockets[0]!;
    authenticate(socket);
    socket.deliver({ kind: "subscribed", channel: "user:u1" });
    socket.deliver({ kind: "error", channel: "forbidden" });
    remove();
    socket.deliver({ kind: "subscribed", channel: "forbidden" });
    socket.deliver({ kind: "subscribed", channel: "removed" });
    socket.deliver({ kind: "unsubscribed", channel: "removed" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(deniedHandler).toHaveBeenCalledExactlyOnceWith({ kind: "error", channel: "forbidden" });
    expect(socket.closed).toBe(false);
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for the old subscribe and unsubscribe barriers before resubscribing a re-added channel", async () => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("user:u1", vi.fn());
    const remove = mux.subscribe("pipeline:p1", vi.fn());
    await flush();
    const socket = sockets[0]!;
    authenticate(socket);
    socket.deliver({ kind: "subscribed", channel: "user:u1" });
    remove();
    const replacement = vi.fn();
    mux.subscribe("pipeline:p1", replacement);
    expect(socket.subscribedChannels()).toEqual(["user:u1", "pipeline:p1"]);
    socket.deliver({ kind: "subscribed", channel: "pipeline:p1" });
    expect(replacement).not.toHaveBeenCalled();
    expect(socket.frames().at(-1)).toEqual({ kind: "unsubscribe", channel: "pipeline:p1" });
    socket.deliver({ kind: "unsubscribed", channel: "pipeline:p1" });
    expect(socket.subscribedChannels()).toEqual(["user:u1", "pipeline:p1", "pipeline:p1"]);
    expect(replacement).not.toHaveBeenCalled();
    socket.deliver({ kind: "subscribed", channel: "pipeline:p1" });
    expect(replacement).toHaveBeenCalledWith({ kind: "resync", channel: "pipeline:p1" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(socket.closed).toBe(false);
  });

  it("last unsubscribe from the outage callback cancels the already-owned retry timer", async () => {
    const { mux, sockets, mintTicket } = setup();
    let remove = () => {};
    remove = mux.subscribe("user:u1", (frame) => {
      if (frame.kind === "reconnect") remove();
    });
    await flush();
    sockets[0]!.close();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mintTicket).toHaveBeenCalledTimes(1);
  });

  it("adding channels cannot extend an older pending ACK deadline", async () => {
    const { mux, sockets } = setup();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    authenticate(sockets[0]!);
    await vi.advanceTimersByTimeAsync(9_000);
    mux.subscribe("pipeline:new", vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets[0]!.closed).toBe(true);
  });

  it("last unsubscribe aborts mint, cancels all timers, and discards late success before remint", async () => {
    const { mux, sockets, mintTicket } = setup();
    const pending = deferredTicket();
    mintTicket.mockReturnValueOnce(pending.promise);
    const remove = mux.subscribe("old", vi.fn());
    const signal = mintTicket.mock.calls[0]![0];
    remove();
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    mux.subscribe("new", vi.fn());
    expect(mintTicket).toHaveBeenCalledTimes(1);
    pending.resolve("abandoned-ticket");
    await flush();
    expect(sockets).toHaveLength(1);
    authenticate(sockets[0]!);
    expect(sockets[0]!.frames()[0]!.ticket).toBe("ticket-1");
    expect(sockets[0]!.subscribedChannels()).toEqual(["new"]);
  });

  it("ignores rejection from an abandoned mint without a retry or outage for the replacement", async () => {
    const { mux, sockets, mintTicket } = setup();
    const pending = deferredTicket();
    mintTicket.mockReturnValueOnce(pending.promise);
    mux.subscribe("old", vi.fn())();
    const handler = vi.fn();
    mux.subscribe("new", handler);
    pending.reject(new TicketAuthorizationDenied());
    await flush();
    authenticate(sockets[0]!);
    expect(handler).not.toHaveBeenCalled();
    expect(sockets[0]!.subscribedChannels()).toEqual(["new"]);
    expect(mintTicket).toHaveBeenCalledTimes(2);
  });

  it("ignores queued messages, opens, errors, closes and deadlines from an abandoned socket", async () => {
    const { mux, sockets, mintTicket } = setup();
    const remove = mux.subscribe("old", vi.fn());
    await flush();
    const old = sockets[0]!;
    const callbacks = {
      open: old.onopen,
      message: old.onmessage,
      error: old.onerror,
      close: old.onclose,
    };
    await vi.advanceTimersByTimeAsync(9_000);
    remove();
    const handler = vi.fn();
    mux.subscribe("new", handler);
    await flush();
    old.readyState = WebSocket.OPEN;
    callbacks.open?.();
    callbacks.message?.({ data: JSON.stringify({ kind: "auth_ok" }) });
    callbacks.message?.({ data: JSON.stringify({ kind: "reconnect" }) });
    callbacks.error?.();
    callbacks.close?.();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets[1]!.closed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    authenticate(sockets[1]!);
    expect(sockets[1]!.subscribedChannels()).toEqual(["new"]);
    expect(mintTicket).toHaveBeenCalledTimes(2);
  });

  it("fresh-mints after socket 4401 instead of treating the expired ticket as HTTP auth denial", async () => {
    const { mux, sockets, mintTicket } = setup();
    mux.subscribe("user:u1", vi.fn());
    await flush();
    sockets[0]!.open();
    // The browser close callback handles every close code, including a single-use ticket 4401.
    const close = sockets[0]!.onclose as ((event: { code: number }) => void) | null;
    sockets[0]!.readyState = WebSocket.CLOSED;
    close?.({ code: 4401 });
    await vi.advanceTimersByTimeAsync(500);
    expect(mintTicket).toHaveBeenCalledTimes(2);
    sockets[1]!.open();
    expect(sockets[1]!.frames()[0]).toEqual({ kind: "auth", ticket: "ticket-2" });
  });

  it("enforces absolute deadlines even if a background tab defers its timer callbacks", async () => {
    const { mux, sockets, mintTicket } = setup();
    const pending = deferredTicket();
    mintTicket.mockReturnValueOnce(pending.promise);
    mux.subscribe("user:u1", vi.fn());
    vi.setSystemTime(60_000);
    pending.resolve("late-ticket");
    await flush();
    expect(sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    const socket = sockets[0]!;
    vi.setSystemTime(100_000);
    socket.open();
    expect(socket.closed).toBe(true);
    expect(socket.sent).toEqual([]);
  });

  it("ignores an already-queued stale deadline callback after unmount and replacement", async () => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const { mux, sockets } = setup();
    const remove = mux.subscribe("old", vi.fn());
    const deadline = timeout.mock.calls[0]![0];
    await flush();
    remove();
    mux.subscribe("new", vi.fn());
    await flush();
    if (typeof deadline === "function") deadline();
    authenticate(sockets[1]!);
    expect(sockets[1]!.closed).toBe(false);
    expect(sockets[1]!.subscribedChannels()).toEqual(["new"]);
  });

  it("ignores malformed protocol frames and cancels retry on final unsubscribe", async () => {
    const { mux, sockets, mintTicket } = setup();
    const remove = mux.subscribe("user:u1", vi.fn());
    await flush();
    authenticate(sockets[0]!);
    for (const frame of [null, 1, {}, { kind: null }]) sockets[0]!.deliver(frame);
    sockets[0]!.close();
    remove();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mintTicket).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
