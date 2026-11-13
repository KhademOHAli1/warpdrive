import { once } from "node:events";
import { Client } from "pg";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db, pool } from "@/db/client";
import { installSignalShutdown } from "@/server/runtime/shutdown";
import { createRelay, type Relay } from "@/server/ws/relay";
import { type ManagedWsServer, startWsServer } from "@/server/ws/server";

// Bundled entrypoint for the compose `ws` service. The relay's pg Client is dedicated
// to LISTEN and is separate from the app pool.
const listenClient = new Client({ connectionString: env.DATABASE_URL });
let relay: Relay | undefined;
let server: ManagedWsServer | undefined;
let startupFailed = false;
const starting = Promise.resolve().then(async () => {
  await listenClient.connect();
  relay = createRelay(listenClient);
  server = startWsServer(8080, { db, relay }, env.WS_HOST);
  server.on("error", () => {
    startupFailed = true;
    void shutdown.request();
  });
  await once(server, "listening");
  console.warn(`ws server listening on ${env.WS_HOST ?? "all interfaces"}:8080`);
});
const settled = starting.catch(() => {
  startupFailed = true;
});
const shutdown = installSignalShutdown({
  source: "realtime",
  timeoutMs: 15_000,
  steps: [
    {
      name: "sockets",
      run: async () => {
        await settled;
        await server?.drain();
      },
    },
    {
      name: "relay",
      run: async () => {
        await settled;
        if (relay) await relay.close();
        else await listenClient.end();
      },
    },
    { name: "database", run: () => pool.end() },
    {
      name: "startup",
      run() {
        if (startupFailed)
          throw new AppError(ERROR_IDS.RUNTIME_REALTIME_STARTUP_FAILED, "Realtime startup failed");
      },
    },
  ],
});
listenClient.on("error", () => {
  startupFailed = true;
  void shutdown.request();
});
void starting.catch(() => shutdown.request());
