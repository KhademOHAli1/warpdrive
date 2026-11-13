import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { requireCoreProfile } from "@/config/coreEnv";
import { env } from "@/config/env";
import { coreProducerOptions } from "@/jobs/coreProducer";
import {
  applicationPoolOptions,
  coreDatabaseRole,
  poolProfileKey,
  reuseApplicationPool,
} from "./corePoolProfile";

const connectionString = "postgres://core_runtime:synthetic-secret@127.0.0.1/fixture";
const profile = { ...env, RUNTIME_COMPONENT: "core-api" as const };

describe("Core connection profile", () => {
  it("preserves the exact legacy options and requires an explicit Core process profile", () => {
    expect(applicationPoolOptions(connectionString, { ...env, RUNTIME_COMPONENT: "web" })).toEqual({
      connectionString,
    });
    expect(() => requireCoreProfile({ ...env, RUNTIME_COMPONENT: "web" })).toThrow(
      "Core profile required",
    );
    expect(() => requireCoreProfile(profile)).not.toThrow();
  });

  it("sets actual installed pool limits without connecting or adding a context pool", async () => {
    const pool = new Pool(applicationPoolOptions(connectionString, profile));
    expect(pool.options).toMatchObject({
      max: 8,
      connectionTimeoutMillis: 2_000,
      statement_timeout: 30_000,
      query_timeout: 35_000,
      lock_timeout: 2_000,
      options: "-c idle_in_transaction_session_timeout=0",
      application_name: "warpdrive-core-api",
    });
    expect(pool.totalCount).toBe(0);
    await pool.end();
  });

  it("keeps producer-only semantics with its own finite connection budget and no LISTEN client", () => {
    expect(coreProducerOptions(connectionString, profile)).toMatchObject({
      max: 2,
      migrate: false,
      createSchema: false,
      schedule: false,
      supervise: false,
      reindex: false,
      persistQueueStats: false,
      useListenNotify: false,
    });
  });

  it("rejects DSN overrides before pg can reparse explicit process limits", () => {
    for (const query of [
      "statement_timeout=0",
      "options=-c%20statement_timeout%3D0",
      "query_timeout=0",
      "application_name=other",
      "user=owner",
      "host=other",
      "max=100",
    ])
      expect(() => applicationPoolOptions(`${connectionString}?${query}`, profile)).toThrow(
        "Invalid Core database profile",
      );
    expect(coreDatabaseRole(`${connectionString}?sslmode=require`)).toBe("core_runtime");
    expect(coreDatabaseRole(connectionString.replace("core_runtime", "core%5Fruntime"))).toBe(
      "core_runtime",
    );
    expect(() => coreDatabaseRole("postgres://127.0.0.1/fixture")).toThrow(
      "Invalid Core database profile",
    );
  });

  it("keys development reuse by the whole effective configuration", () => {
    const original = applicationPoolOptions(connectionString, profile);
    expect(poolProfileKey(original)).toBe(poolProfileKey({ ...original }));
    expect(poolProfileKey(original)).not.toBe(
      poolProfileKey(applicationPoolOptions(connectionString, { ...profile, CORE_DB_MAX: 9 })),
    );
    expect(poolProfileKey(original)).not.toBe(poolProfileKey({ connectionString }));
  });

  it("adopts the matching legacy cache but requires restart before replacing an owned pool", async () => {
    const pool = new Pool({ connectionString });
    const legacy = { connectionString };
    const core = applicationPoolOptions(connectionString, profile);
    try {
      expect(reuseApplicationPool(undefined, core)).toBeUndefined();
      expect(reuseApplicationPool({ pool, connectionString }, legacy)).toBe(pool);
      expect(reuseApplicationPool({ pool, profileKey: poolProfileKey(core) }, core)).toBe(pool);
      expect(() => reuseApplicationPool({ pool, connectionString }, core)).toThrow(
        "restart the process",
      );
      expect(() =>
        reuseApplicationPool(
          { pool, profileKey: poolProfileKey(core) },
          applicationPoolOptions(connectionString, { ...profile, CORE_DB_MAX: 9 }),
        ),
      ).toThrow("restart the process");
      expect(pool.ending).toBe(false);
      expect(pool.totalCount).toBe(0);
    } finally {
      await pool.end();
    }
  });
});
