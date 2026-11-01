import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { err, ok, type Result } from "@/types/result";
import { inspectMigrationAdmission } from "./migrationAdmissionDatabase";
import { verifyMigrationIntegrity } from "./migrationAdmissionIntegrity";
import { readCanonicalMigrations } from "./migrationAdmissionSource";

// Default location: <repo-root>/drizzle, resolved relative to this module (src/db/migrate.ts),
// not process.cwd(), so migrations are found regardless of where the process starts. Callers can
// override this: once esbuild bundles the entrypoint, import.meta.url points at the OUTPUT file,
// so the relative walk no longer lands on <root>/drizzle. The bundled entrypoint passes an
// explicit folder (resolved from the container WORKDIR) instead of relying on this default.
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));
const MIGRATION_LOCK = "warpdrive:canonical-migrations";

// Pure-ish: applies forward-only migrations against a supplied db. Returns a Result so a
// caller (the one-shot Compose step) can exit non-zero on failure instead of a raw throw.
// Takes an explicit db so the real-Postgres test can drive it without the app pool.
export async function applyMigrations(
  db: NodePgDatabase<Record<string, unknown>>,
  signal?: AbortSignal,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<Result<{ applied: true }, string>> {
  const currentSignal = signal ?? AbortSignal.timeout(30_000);
  let rejection: string | undefined;
  try {
    currentSignal.throwIfAborted();
    const loaded = await readCanonicalMigrations(migrationsFolder, currentSignal);
    if (!loaded.ok) return loaded;
    return await db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '10s'`);
        await tx.execute(sql`SET LOCAL search_path = public, pg_catalog`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${MIGRATION_LOCK}))`);
        currentSignal.throwIfAborted();
        const admitted = await inspectMigrationAdmission(tx, loaded.value, currentSignal);
        if (!admitted.ok) return admitted;
        const before = await verifyMigrationIntegrity(
          tx,
          loaded.value.slice(0, admitted.value),
          currentSignal,
        );
        if (!before.ok) return before;
        // Stock migrate(tx) uses the underlying session's BEGIN/COMMIT, not a savepoint.
        // Execute its already-hashed SQL/receipt format here so the fence spans one transaction.
        await tx.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
        await tx.execute(sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
      )`);
        for (const migration of loaded.value.slice(admitted.value)) {
          for (const statement of migration.sql) {
            currentSignal.throwIfAborted();
            if (statement.trim() !== "") await tx.execute(sql.raw(statement));
          }
          await tx.execute(sql`INSERT INTO drizzle.__drizzle_migrations(hash,created_at)
          VALUES(${migration.hash},${migration.when})`);
        }
        const integrity = await verifyMigrationIntegrity(tx, loaded.value, currentSignal);
        if (!integrity.ok) {
          rejection = integrity.error;
          tx.rollback();
        }
        currentSignal.throwIfAborted();
        return ok({ applied: true as const });
      },
      { isolationLevel: "read committed" },
    );
  } catch (e) {
    currentSignal.throwIfAborted();
    if (rejection !== undefined) return err(rejection);
    if (e instanceof Error && e.name === "AbortError") throw e; // never swallow cancellation
    return err(e instanceof Error ? e.message : String(e));
  }
}

// Public interface (E4 Compose entrypoint / first-run bootstrap import this): apply against
// the app db. Lazy import keeps tests from constructing the app pool just by importing here.
async function runMigrations(
  signal?: AbortSignal,
  migrationsFolder?: string,
): Promise<Result<{ applied: true }, string>> {
  const { db } = await import("./client");
  return applyMigrations(db, signal, migrationsFolder);
}

// Entrypoint for the one-shot Compose `migrate` service (E4): apply, then exit 0/1.
// Exported so the bundled entrypoint (src/entrypoints/migrate.ts) can invoke it after
// esbuild strips the argv-based self-start guard's filename match. The bundled entrypoint
// passes an explicit migrations folder (import.meta.url is unreliable post-bundle).
export async function runMigrationsCli(migrationsFolder?: string): Promise<void> {
  const { pool } = await import("./client");
  const result = await runMigrations(undefined, migrationsFolder);
  await pool.end();
  if (!result.ok) {
    console.error(`migration failed: ${result.error}`);
    process.exit(1);
  }
  // console.warn (not log): no-console lint rule allows warn/error only.
  console.warn("migrations applied");
  process.exit(0);
}
