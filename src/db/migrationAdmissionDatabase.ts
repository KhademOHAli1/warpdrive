import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { type CanonicalMigration, validateMigrationLedger } from "./migrationAdmission";

type MigrationExecutor = Pick<NodePgDatabase<Record<string, unknown>>, "execute">;
const singleBoolean = z.tuple([z.object({ present: z.boolean() })]);

async function ledgerPresent(db: MigrationExecutor, signal: AbortSignal): Promise<boolean | null> {
  const result = await db.execute(
    sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present`,
  );
  signal.throwIfAborted();
  const parsed = singleBoolean.safeParse(result.rows);
  return parsed.success ? parsed.data[0].present : null;
}

async function unmanagedObjects(db: MigrationExecutor, signal: AbortSignal): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    ) AS present`);
  signal.throwIfAborted();
  const parsed = singleBoolean.safeParse(result.rows);
  return !parsed.success || parsed.data[0].present;
}

async function workflowPresent(db: MigrationExecutor, signal: AbortSignal): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT (to_regclass('public.workflows') IS NOT NULL
      OR to_regclass('public.workflow_versions') IS NOT NULL
      OR to_regclass('public.workflow_runs') IS NOT NULL
      OR to_regclass('public.workflow_steps') IS NOT NULL
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'workflow_version_immutable')) AS present`);
  signal.throwIfAborted();
  const parsed = singleBoolean.safeParse(result.rows);
  return !parsed.success || parsed.data[0].present;
}

export async function inspectMigrationAdmission(
  db: MigrationExecutor,
  canonical: readonly CanonicalMigration[],
  signal: AbortSignal,
): Promise<Result<number, string>> {
  const present = await ledgerPresent(db, signal);
  if (present === null) return err("invalid migration metadata");
  const rows = present
    ? (
        await db.execute(
          sql`SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
        )
      ).rows
    : [];
  signal.throwIfAborted();
  const admitted = validateMigrationLedger(canonical, rows);
  if (!admitted.ok) return admitted;
  if (admitted.value === 0 && (await unmanagedObjects(db, signal)))
    return err("refusing an unmanaged application schema without canonical history");
  const workflow = canonical.findIndex((entry) => entry.tag.endsWith("_visual_workflows"));
  if (workflow >= 0 && admitted.value <= workflow && (await workflowPresent(db, signal)))
    return err("refusing pre-existing workflow objects before the canonical workflow migration");
  return admitted;
}

// This verifies the workflow protections this merge introduces, not all schema drift.
export async function verifyWorkflowMigration(
  db: MigrationExecutor,
  canonical: readonly CanonicalMigration[],
  signal: AbortSignal,
): Promise<Result<true, string>> {
  const workflow = canonical.find((entry) => entry.tag.endsWith("_visual_workflows"));
  if (workflow === undefined) return ok(true);
  const immutableBody = workflow.sql
    .join("\n")
    .match(
      /CREATE FUNCTION public\.workflow_version_immutable\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/u,
    )?.[1];
  if (immutableBody === undefined) return err("invalid canonical workflow protection source");
  const result = await db.execute(sql`
    SELECT (to_regclass('public.workflows') IS NOT NULL
      AND to_regclass('public.workflow_versions') IS NOT NULL
      AND to_regclass('public.workflow_runs') IS NOT NULL
      AND to_regclass('public.workflow_steps') IS NOT NULL
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'workflow_run_pinned_version_fk' AND contype = 'f' AND convalidated
          AND pg_catalog.pg_get_constraintdef(oid, false) = 'FOREIGN KEY (version_id, workflow_id) REFERENCES workflow_versions(id, workflow_id)'
          AND conrelid = 'public.workflow_runs'::regclass AND confrelid = 'public.workflow_versions'::regclass)
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'workflows_published_version_fk' AND contype = 'f' AND convalidated
          AND pg_catalog.pg_get_constraintdef(oid, false) = 'FOREIGN KEY (id, published_number) REFERENCES workflow_versions(workflow_id, number)'
          AND conrelid = 'public.workflows'::regclass AND confrelid = 'public.workflow_versions'::regclass)
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
        JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        WHERE t.tgname = 'workflow_versions_immutable' AND NOT t.tgisinternal
          AND t.tgrelid = 'public.workflow_versions'::regclass AND t.tgenabled = 'O'
          AND n.nspname = 'public' AND p.proname = 'workflow_version_immutable'
          AND t.tgtype = 27 AND t.tgqual IS NULL AND t.tgattr = ''::int2vector
          AND t.tgnargs = 0 AND p.pronargs = 0 AND NOT p.prosecdef
          AND p.proconfig = ARRAY['search_path=pg_catalog']
          AND l.lanname = 'plpgsql' AND p.prosrc = ${immutableBody})) AS present`);
  signal.throwIfAborted();
  const parsed = singleBoolean.safeParse(result.rows);
  return parsed.success && parsed.data[0].present
    ? ok(true)
    : err("canonical workflow integrity checks failed");
}
