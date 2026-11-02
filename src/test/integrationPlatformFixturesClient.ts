import { Socket } from "node:net";
import { Client } from "pg";

const CLOSE_TIMEOUT_MS = 250;

export function createIntegrationFixtureClient(connectionString: string) {
  const health = { failed: false };
  const transport = new Socket();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 1000,
    statement_timeout: 4000,
    query_timeout: 5000,
    application_name: "warpdrive-integration-fixture",
    pipeline: false,
    ssl: false,
    stream: () => transport,
  });
  // Idle transport failures are also events. Retain no private pg error/configuration data.
  client.on("error", () => {
    health.failed = true;
  });
  let closing: Promise<void> | undefined;
  const force = () => {
    health.failed = true;
    transport.destroy();
  };
  const close = (signal: AbortSignal): Promise<void> => {
    if (closing !== undefined) return closing;
    closing = (async () => {
      const watchdog = setTimeout(force, CLOSE_TIMEOUT_MS);
      signal.addEventListener("abort", force, { once: true });
      try {
        if (signal.aborted) force();
        await client.end();
      } catch {
        force();
      } finally {
        clearTimeout(watchdog);
        signal.removeEventListener("abort", force);
        transport.destroy();
      }
    })();
    return closing;
  };
  return { client, health, close };
}
