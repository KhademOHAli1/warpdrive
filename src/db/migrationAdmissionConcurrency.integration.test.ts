import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import { applyMigrations } from "./migrate";
import { ledger, migrationFolder } from "./migrationAdmission.test-helpers";

describe("migration admission serialization", () => {
  it("serializes overlapping runners and records a pending migration once", async () => {
    const h = await makeTestDb();
    const fixture = await migrationFolder(undefined, false, false, true);
    try {
      const before = await ledger(h);
      const results = await Promise.all([
        applyMigrations(h.db, undefined, fixture.folder),
        applyMigrations(h.db, undefined, fixture.folder),
      ]);
      expect(results.every((result) => result.ok)).toBe(true);
      const after = await ledger(h);
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after).toHaveLength(before.length + 1);
      expect((await h.db.execute(sql`SELECT id FROM migration_serialization_probe`)).rows).toEqual([
        { id: 1 },
      ]);
    } finally {
      await fixture.dispose();
      await h.close();
    }
  });

  it("bounds an advisory lock wait and preserves the ledger and connection", async () => {
    const h = await makeTestDb();
    const holder = await h.pool.connect();
    try {
      const before = await ledger(h);
      await holder.query("BEGIN");
      await holder.query(
        "SELECT pg_advisory_xact_lock(hashtext('warpdrive:canonical-migrations'))",
      );
      const started = performance.now();
      const result = await applyMigrations(h.db);
      const elapsed = performance.now() - started;
      expect(result.ok).toBe(false);
      expect(elapsed).toBeGreaterThan(1_000);
      expect(elapsed).toBeLessThan(5_000);
      expect(await ledger(h)).toEqual(before);
      expect((await h.db.execute(sql`SELECT 1 AS value`)).rows).toEqual([{ value: 1 }]);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await h.close();
    }
  });
});
