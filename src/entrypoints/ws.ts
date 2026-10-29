import { Client } from "pg";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { createRelay } from "@/server/ws/relay";
import { startWsServer } from "@/server/ws/server";

// Bundled entrypoint for the compose `ws` service. The relay's pg Client is dedicated
// to LISTEN and is separate from the app pool.
const listenClient = new Client({ connectionString: env.DATABASE_URL });
await listenClient.connect();
startWsServer(8080, { db, relay: createRelay(listenClient) }, env.WS_HOST);
console.warn(`ws server listening on ${env.WS_HOST ?? "all interfaces"}:8080`);
