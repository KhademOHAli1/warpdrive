import { createServer, type Socket } from "node:net";
import { expect, test } from "vitest";
import { createIntegrationFixtureClient } from "./integrationPlatformFixturesClient";

test("the owned pg client observes idle error events before connect and records only safe failure state", async () => {
  const owned = createIntegrationFixtureClient(
    "postgres://synthetic:fixture-only@127.0.0.1:1/t_11111111111111111111111111111111",
  );
  try {
    expect(() =>
      owned.client.emit("error", new TypeError("private URL and credential detail")),
    ).not.toThrow();
    expect(owned.health).toEqual({ failed: true });
    expect(JSON.stringify(owned.health)).not.toContain("private");
  } finally {
    // Constructing/ending an unconnected Client opens no network socket or database.
    await owned.close(new AbortController().signal);
  }
});

test("owned teardown forces its transport closed when an idle protocol peer withholds FIN", async () => {
  const sockets = new Set<Socket>();
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    let startup = true;
    socket.on("error", () => socket.destroy());
    socket.on("data", () => {
      if (!startup) return;
      startup = false;
      // Native transport framing only: AuthenticationOk + ReadyForQuery, never SQL/database data.
      socket.write(Buffer.from("5200000008000000005a0000000549", "hex"));
    });
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
  const owned = createIntegrationFixtureClient(
    `postgres://synthetic:fixture@127.0.0.1:${address.port}/t_11111111111111111111111111111111`,
  );
  let ending: Promise<void> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await owned.client.connect();
    ending = owned.close(new AbortController().signal);
    const completed = await Promise.race([
      ending.then(() => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 1000);
      }),
    ]);
    expect(completed).toBe(true);
    expect(owned.health.failed).toBe(true);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    for (const socket of sockets) socket.destroy();
    await (ending ?? owned.client.end());
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
});
