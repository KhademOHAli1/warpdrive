import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import { applyMigrations } from "@/db/migrate";
import {
  freshMigrationDb,
  installPrefix,
  migrationFolder,
} from "@/db/migrationAdmission.test-helpers";
import journal from "../../../drizzle/meta/_journal.json";

it("upgrades a populated pre-billing installation without changing legacy rows or receipts", async () => {
  const h = await freshMigrationDb();
  const canonicalCut = await migrationFolder(106);
  try {
    const latest = journal.entries[105];
    expect(latest?.tag).toBe("0105_workspace_billing");
    if (latest === undefined) return;
    // Install real historical SQL in this disposable database, preserving the
    // test's exact 0104 -> 0105 cut when later migrations are appended.
    await installPrefix(h, 105);
    await h.pool.query(
      "INSERT INTO settings (id,company_name,base_currency) VALUES (true,'Populated legacy company','EUR') ON CONFLICT (id) DO UPDATE SET company_name=EXCLUDED.company_name,base_currency=EXCLUDED.base_currency",
    );
    const before = await h.pool.query("SELECT row_to_json(s) AS row FROM settings s");
    const receipts = await h.pool.query(
      "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    expect(receipts.rows).toHaveLength(105);
    expect((await applyMigrations(drizzle(h.pool), undefined, canonicalCut.folder)).ok).toBe(true);
    expect((await h.pool.query("SELECT row_to_json(s) AS row FROM settings s")).rows).toEqual(
      before.rows,
    );
    expect(
      (
        await h.pool.query(
          "SELECT hash,created_at FROM drizzle.__drizzle_migrations WHERE created_at <> $1 ORDER BY created_at",
          [latest.when],
        )
      ).rows,
    ).toEqual(receipts.rows);
    expect(
      (
        await h.pool.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'billing_%'",
        )
      ).rows,
    ).toHaveLength(4);
    expect((await applyMigrations(drizzle(h.pool), undefined, canonicalCut.folder)).ok).toBe(true);
    expect(
      (await h.pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations"))
        .rows[0]?.count,
    ).toBe(106);
  } finally {
    await canonicalCut.dispose();
    await h.close();
  }
});
