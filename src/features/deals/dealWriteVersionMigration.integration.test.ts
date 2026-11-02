import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import { canonicalFolder, installPrefix, ledger } from "@/db/migrationAdmission.test-helpers";
import { readCanonicalMigrations } from "@/db/migrationAdmissionSource";
import { makeTestDb } from "@/test/db";
import {
  insertLegacyWriteVersionDeal,
  previousDealFields,
  seedWriteVersionParents,
  storedWriteVersion,
  UUID_V4,
  unrelatedRevisionRows,
} from "./dealWriteVersion.test-helpers";

it("upgrades the populated canonical 0098 predecessor once, preserving old fields and relations", async () => {
  const h = await makeTestDb();
  try {
    await h.db.execute(sql`DROP SCHEMA public CASCADE`);
    await h.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
    await h.db.execute(sql`CREATE SCHEMA public`);
    await installPrefix(h, 99);
    const oldColumn = await h.pool.query<{ present: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='deals' AND column_name='write_version') AS present
    `);
    expect(oldColumn.rows).toEqual([{ present: false }]);
    const parents = await seedWriteVersionParents(h);
    const ids = [
      await insertLegacyWriteVersionDeal(h.pool, parents, { title: "Active" }),
      await insertLegacyWriteVersionDeal(h.pool, parents, {
        title: "Archived won",
        status: "won",
        archived: true,
      }),
      await insertLegacyWriteVersionDeal(h.pool, parents, {
        title: "Deleted lost",
        status: "lost",
        deleted: true,
      }),
    ];
    const fields = await Promise.all(ids.map((id) => previousDealFields(h.pool, id)));
    const unrelated = await unrelatedRevisionRows(h.pool);
    const beforeLedger = await ledger(h);
    expect(beforeLedger).toHaveLength(99);

    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });

    expect(await Promise.all(ids.map((id) => previousDealFields(h.pool, id)))).toEqual(fields);
    expect(await unrelatedRevisionRows(h.pool)).toEqual(unrelated);
    const versions = await Promise.all(ids.map((id) => storedWriteVersion(h.pool, id)));
    for (const version of versions) expect(version).toMatch(UUID_V4);
    expect(new Set(versions).size).toBe(ids.length);
    const afterLedger = await ledger(h);
    expect(afterLedger).toHaveLength(100);
    expect(afterLedger.slice(0, 99)).toEqual(beforeLedger);
    const canonical = await readCanonicalMigrations(canonicalFolder, new AbortController().signal);
    expect(canonical.ok).toBe(true);
    if (canonical.ok) {
      const admitted = canonical.value[99];
      expect(admitted?.tag).toBe("0099_deal_write_version");
      expect(afterLedger[99]).toMatchObject({
        hash: admitted?.hash,
        created_at: String(admitted?.when),
      });
    }

    expect(await applyMigrations(h.db)).toEqual({ ok: true, value: { applied: true } });
    expect(await ledger(h)).toEqual(afterLedger);
    expect(await Promise.all(ids.map((id) => storedWriteVersion(h.pool, id)))).toEqual(versions);
    expect(await Promise.all(ids.map((id) => previousDealFields(h.pool, id)))).toEqual(fields);
    expect(await unrelatedRevisionRows(h.pool)).toEqual(unrelated);
  } finally {
    await h.close();
  }
});
