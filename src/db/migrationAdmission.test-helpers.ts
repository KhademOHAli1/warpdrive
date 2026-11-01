import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { makeTestDb, type TestDb } from "@/test/db";
import { parseMigrationJournal } from "./migrationAdmission";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const canonicalFolder = path.join(ROOT, "drizzle");

export async function freshMigrationDb(): Promise<TestDb> {
  const h = await makeTestDb();
  await h.db.execute(sql`DROP SCHEMA public CASCADE`);
  await h.db.execute(sql`DROP SCHEMA drizzle CASCADE`);
  await h.db.execute(sql`CREATE SCHEMA public`);
  return h;
}

export async function migrationFolder(
  prefix?: number,
  legacyWorkflow = false,
  fail = false,
  pause = false,
) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "warpdrive-migration-admission-"));
  await mkdir(path.join(folder, "meta"));
  const raw: unknown = JSON.parse(
    await readFile(path.join(canonicalFolder, "meta/_journal.json"), "utf8"),
  );
  const parsed = parseMigrationJournal(raw);
  if (!parsed.ok) throw new TypeError(parsed.error);
  const entries = parsed.value.slice(0, prefix);
  for (const entry of entries)
    await copyFile(
      path.join(canonicalFolder, `${entry.tag}.sql`),
      path.join(folder, `${entry.tag}.sql`),
    );
  if (legacyWorkflow) {
    const archive = path.join(ROOT, "docs/migration-history/workflow-original");
    const historical: unknown = JSON.parse(
      await readFile(path.join(archive, "_journal.json"), "utf8"),
    );
    const original = parseMigrationJournal(historical);
    if (!original.ok) throw new TypeError(original.error);
    const entry = original.value.at(-1);
    if (entry === undefined) throw new TypeError("missing historical workflow entry");
    entries.push(entry);
    await copyFile(path.join(archive, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  if (fail || pause) {
    const previous = entries.at(-1);
    if (previous === undefined) throw new TypeError("missing fixture prefix");
    const tag = `${String(entries.length).padStart(4, "0")}_${fail ? "intentional_failure" : "serialization_probe"}`;
    entries.push({
      idx: entries.length,
      version: "7",
      when: previous.when + 1,
      tag,
      breakpoints: true,
    });
    await writeFile(
      path.join(folder, `${tag}.sql`),
      fail
        ? "CREATE TABLE migration_rollback_probe(id integer);\nSELECT missing_migration_function();"
        : "CREATE TABLE migration_serialization_probe(id integer PRIMARY KEY); INSERT INTO migration_serialization_probe VALUES(1); SELECT pg_sleep(0.2);",
    );
  }
  await writeFile(
    path.join(folder, "meta/_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }),
  );
  return { folder, dispose: () => rm(folder, { recursive: true, force: true }) };
}

export async function installPrefix(
  h: TestDb,
  prefix: number,
  legacyWorkflow = false,
): Promise<void> {
  const fixture = await migrationFolder(prefix, legacyWorkflow);
  try {
    await migrate(h.db, { migrationsFolder: fixture.folder });
  } finally {
    await fixture.dispose();
  }
}

export async function ledger(h: TestDb) {
  return (
    await h.db.execute(
      sql`SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
    )
  ).rows;
}

export async function ledgerExists(h: TestDb) {
  return (await h.db.execute(sql`SELECT to_regclass('drizzle.__drizzle_migrations') AS value`))
    .rows;
}
