import type { Pool } from "pg";
import { afterEach, expect, test, vi } from "vitest";

const opened = new Set<Pool>();
afterEach(async () => {
  for (const pool of opened) await pool.end();
  opened.clear();
  delete (globalThis as { warpdrivePostgres?: unknown }).warpdrivePostgres;
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("development hot reload reuses its real PostgreSQL pool", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.resetModules();
  const first = await import("./client");
  opened.add(first.pool);
  vi.resetModules();
  const reloaded = await import("./client");
  opened.add(reloaded.pool);
  expect(reloaded.pool).toBe(first.pool);
});
