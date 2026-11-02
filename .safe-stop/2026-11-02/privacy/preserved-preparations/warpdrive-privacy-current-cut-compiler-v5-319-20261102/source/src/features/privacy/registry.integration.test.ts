import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { checkRegistryCoverage, privacyRegistry } from "./registry";
import type { DiscoveredInventoryItem } from "./registryTypes";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function catalog(): Promise<DiscoveredInventoryItem[]> {
  const rows = await h.db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  return rows.rows.map((row) => ({
    id: `table:${row.tablename}`,
    kind: "table",
    source: "migrated-postgresql-catalog",
  }));
}

describe("migrated table inventory (P01A/P01B)", () => {
  it("classifies every actual application table after all real migrations", async () => {
    const actual = await catalog();
    expect(actual.length).toBeGreaterThan(70);
    expect(checkRegistryCoverage(actual, privacyRegistry)).toEqual({
      ok: true,
      missing: [],
      invalid: [],
    });
  });

  it("fails on a new real table with no declaration", async () => {
    await h.db.execute(sql`CREATE TABLE privacy_unregistered_fixture (id integer PRIMARY KEY)`);
    try {
      const report = checkRegistryCoverage(await catalog(), privacyRegistry);
      expect(report.ok).toBe(false);
      expect(report.missing).toContain("table:privacy_unregistered_fixture");
    } finally {
      await h.db.execute(sql`DROP TABLE privacy_unregistered_fixture`);
    }
  });
});
