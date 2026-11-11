import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { Db } from "@/db/client";
import { PresenceHub } from "./presenceHub";
import type { Relay } from "./relay";
import { SocketSession } from "./socketSession";

const { consumeTicketAndBind } = vi.hoisted(() => ({ consumeTicketAndBind: vi.fn() }));
vi.mock("./authorize", () => ({
  consumeTicketAndBind,
  authorizeDeal: vi.fn(),
  authorizeSubscribe: vi.fn(),
}));
vi.mock("@/features/auth/session", () => ({ loadLiveSessionById: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("SocketSession drain", () => {
  it("waits for in-flight auth and prevents it creating new heartbeat/presence work", async () => {
    let complete!: (value: unknown) => void;
    const auth = new Promise((resolve) => {
      complete = resolve;
    });
    consumeTicketAndBind.mockReturnValueOnce(auth);
    const socket = { send: vi.fn(), close: vi.fn() };
    const relay: Relay = { subscribe: vi.fn(), unsubscribe: vi.fn(), close: vi.fn() };
    const database = { select: vi.fn() };
    const session = new SocketSession(
      socket as unknown as WebSocket,
      { db: database as unknown as Db, relay },
      new PresenceHub(),
    );
    const dispatch = session.dispatch(JSON.stringify({ kind: "auth", ticket: "synthetic" }));
    const teardown = session.teardown();
    expect(session.teardown()).toBe(teardown);
    let drained = false;
    void teardown.then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    complete({ ok: true, value: { userId: "synthetic-user", sessionId: "synthetic-session" } });
    await dispatch;
    await teardown;
    expect(database.select).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
    await session.dispatch(JSON.stringify({ kind: "auth", ticket: "later" }));
    expect(consumeTicketAndBind).toHaveBeenCalledTimes(1);
  });

  it("clears the unauthenticated deadline and performs teardown only once", async () => {
    vi.useFakeTimers();
    const socket = { send: vi.fn(), close: vi.fn() };
    const hub = new PresenceHub();
    const drop = vi.spyOn(hub, "dropConnection");
    const session = new SocketSession(
      socket as unknown as WebSocket,
      {
        db: {} as Db,
        relay: { subscribe: vi.fn(), unsubscribe: vi.fn(), close: vi.fn() },
        authTimeoutMs: 20,
      },
      hub,
    );
    const teardown = session.teardown();
    expect(session.teardown()).toBe(teardown);
    await teardown;
    await vi.advanceTimersByTimeAsync(100);
    expect(socket.close).not.toHaveBeenCalled();
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it("reports an in-flight failure only after waiting for the operation to settle", async () => {
    let fail!: (error: Error) => void;
    consumeTicketAndBind.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const session = new SocketSession(
      { send: vi.fn(), close: vi.fn() } as unknown as WebSocket,
      { db: {} as Db, relay: { subscribe: vi.fn(), unsubscribe: vi.fn(), close: vi.fn() } },
      new PresenceHub(),
    );
    const dispatch = session.dispatch(JSON.stringify({ kind: "auth", ticket: "synthetic" }));
    const rejectedDispatch = expect(dispatch).rejects.toThrow("synthetic failure");
    const teardown = session.teardown();
    const rejectedDrain = expect(teardown).rejects.toThrow("did not finish draining");
    fail(new Error("synthetic failure"));
    await rejectedDispatch;
    await rejectedDrain;
  });
});
