import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it } from "vitest";
import journal from "../../drizzle/meta/_journal.json";
import { applyMigrations } from "./migrate";
import {
  freshMigrationDb,
  installPrefix,
  migrationFolder,
} from "./migrationAdmission.test-helpers";

it("upgrades populated 0105 while preserving old data and every historical migration receipt", async () => {
  const h = await freshMigrationDb();
  const cut = await migrationFolder(107);
  try {
    const latest = journal.entries[106];
    expect(latest?.tag).toBe("0106_company_work_profile");
    if (!latest) return;
    await installPrefix(h, 106);
    await h.pool.query(
      "INSERT INTO settings(id,company_name,base_currency) VALUES(true,'Existing workspace','EUR') ON CONFLICT(id) DO UPDATE SET company_name=EXCLUDED.company_name,base_currency=EXCLUDED.base_currency",
    );
    await h.pool.query("INSERT INTO pipelines(name) VALUES('Preserved existing pipeline')");
    const before = await h.pool.query("SELECT row_to_json(s) AS row FROM settings s");
    const pipelines = await h.pool.query("SELECT row_to_json(p) AS row FROM pipelines p");
    const receipts = await h.pool.query(
      "SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
    );
    expect(receipts.rows).toHaveLength(106);
    expect((await applyMigrations(drizzle(h.pool), undefined, cut.folder)).ok).toBe(true);
    expect((await h.pool.query("SELECT row_to_json(s) AS row FROM settings s")).rows).toEqual(
      before.rows,
    );
    expect((await h.pool.query("SELECT row_to_json(p) AS row FROM pipelines p")).rows).toEqual(
      pipelines.rows,
    );
    expect(
      (
        await h.pool.query(
          "SELECT hash,created_at FROM drizzle.__drizzle_migrations WHERE created_at <> $1 ORDER BY created_at",
          [latest.when],
        )
      ).rows,
    ).toEqual(receipts.rows);
    for (const table of [
      "company_profiles",
      "company_legal_entities",
      "company_assets",
      "company_operations",
      "workspace_work_profiles",
      "work_types",
      "work_stages",
      "work_items",
      "work_operations",
      "work_installations",
    ]) {
      expect((await h.pool.query("SELECT to_regclass($1) AS name", [table])).rows[0]?.name).toBe(
        table,
      );
    }
    expect((await applyMigrations(drizzle(h.pool), undefined, cut.folder)).ok).toBe(true);
    expect(
      (await h.pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0]
        ?.n,
    ).toBe(107);
  } finally {
    await cut.dispose();
    await h.close();
  }
});
