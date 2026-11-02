import { createServer, type Socket } from "node:net";
import { afterEach, beforeEach, expect, test } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createIntegrationPlatformFixtures } from "./integrationPlatformFixtures";

let h: TestDb;
beforeEach(async () => {
  h = await makeTestDb();
});
afterEach(async () => {
  await h.close();
});

test("fixture connection acquisition remains bounded while every harness-pool client is held", async () => {
  const held = await Promise.all(Array.from({ length: 4 }, () => h.pool.connect()));
  const pending = createIntegrationPlatformFixtures(
    h,
    { namespace: "poolfull", now: new Date() },
    AbortSignal.timeout(3000),
  ).then(
    (value) => ({ kind: "result" as const, value }),
    () => ({ kind: "aborted" as const }),
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const observed = await Promise.race([
      pending,
      new Promise<{ kind: "still-waiting" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "still-waiting" }), 3500);
      }),
    ]);
    expect(observed.kind).toBe("result");
    if (observed.kind === "result") expect(observed.value.ok).toBe(true);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    for (const client of held) client.release();
    // Observing a timeout never detaches a write: release the test lock and drain its promise.
    await pending;
  }
});

test("a native TCP endpoint that stalls PostgreSQL startup cannot hold fixture cancellation indefinitely", async () => {
  const sockets = new Set<Socket>();
  let accept: () => void = () => undefined;
  const accepted = new Promise<void>((resolve) => {
    accept = resolve;
  });
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    accept();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  expect(address).not.toBeNull();
  if (address === null || typeof address === "string") {
    server.close();
    return;
  }
  const target = new URL(h.url);
  target.hostname = "127.0.0.1";
  target.port = String(address.port);
  const controller = new AbortController();
  const reason = new DOMException("Startup cancelled", "AbortError");
  const pending = createIntegrationPlatformFixtures(
    { ...h, url: target.toString() },
    { namespace: "startup", now: new Date() },
    controller.signal,
  ).then(
    (value) => ({ kind: "result" as const, value }),
    (error: unknown) => ({ kind: "error" as const, error }),
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const connected = await Promise.race([
      accepted.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 2000);
      }),
    ]);
    expect(connected).toBe(true);
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort(reason);
    const observed = await Promise.race([
      pending,
      new Promise<{ kind: "still-waiting" }>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "still-waiting" }), 2000);
      }),
    ]);
    expect(observed).toEqual({ kind: "error", error: reason });
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort(reason);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    await pending;
  }
});
