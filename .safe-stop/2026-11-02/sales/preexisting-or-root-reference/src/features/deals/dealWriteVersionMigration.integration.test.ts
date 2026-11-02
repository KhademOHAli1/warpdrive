import { describe, expect, it } from "vitest";
import { freshMigrationDb, installPrefix } from "@/db/migrationAdmission.test-helpers";
import {
  insertLegacyWriteVersionDeal,
  previousDealFields,
  seedWriteVersionParents,
  storedWriteVersion,
  UUID_V4,
  writeVersionFixtureLedger,
} from "./dealWriteVersion.fixtures";
import { installDealWriteVersionFixture } from "./dealWriteVersion.test-helpers";

describe("deal write-version populated migration", () => {
  it("preserves every old field while backfilling active, archived and soft-deleted rows", async () => {
    const h = await freshMigrationDb();
    try {
      // A true old-schema prefix, even after the default test template gains later migrations.
      await installPrefix(h, 98);
      const oldColumn = await h.pool.query<{ present: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'write_version'
        ) AS present
      `);
      expect(oldColumn.rows).toEqual([{ present: false }]);
      const parents = await seedWriteVersionParents(h.db);
      const ids = [
        await insertLegacyWriteVersionDeal(h.pool, parents, { title: "Active" }),
        await insertLegacyWriteVersionDeal(h.pool, parents, {
          title: "Archived won",
          status: "won",
          archived: true,
        }),
        await insertLegacyWriteVersionDeal(h.pool, parents, {
          title: "Soft-deleted lost",
          status: "lost",
          deleted: true,
        }),
      ];
      const before = await Promise.all(ids.map((id) => previousDealFields(h.pool, id)));
      const ledger = await writeVersionFixtureLedger(h.pool);

      await installDealWriteVersionFixture(h.pool);

      expect(await Promise.all(ids.map((id) => previousDealFields(h.pool, id)))).toEqual(before);
      const versions = await Promise.all(ids.map((id) => storedWriteVersion(h.pool, id)));
      for (const version of versions) expect(version).toMatch(UUID_V4);
      expect(new Set(versions).size).toBe(ids.length);
      // The private fixture overlay must not invent or relabel a canonical migration receipt.
      expect(await writeVersionFixtureLedger(h.pool)).toEqual(ledger);
    } finally {
      await h.close();
    }
  }, 20_000);
});
