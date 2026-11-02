import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { expect } from "vitest";
import { qualificationIdentifier as identifier, qualificationQuery as query } from "./mailMigrationQualification.test-helpers";
import type { QualificationSources } from "./mailMigrationQualificationSource";

export interface QualificationTableSnapshot { columns: string[]; count: number; hash: string }
export type QualificationSnapshot = Record<string, QualificationTableSnapshot>;

export async function captureQualificationRows(pool: Pool, signal: AbortSignal, original?: QualificationSnapshot): Promise<QualificationSnapshot> {
  const tables = original === undefined
    ? (await query<{ table_name: string }>(pool, "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name", [], signal)).rows.map((row) => row.table_name)
    : Object.keys(original);
  const snapshot: QualificationSnapshot = {};
  for (const table of tables) {
    const columns = original?.[table]?.columns ?? (await query<{ column_name: string }>(pool, "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table], signal)).rows.map((row) => row.column_name);
    expect(columns.length).toBeGreaterThan(0);
    const rows = await query<{ row: string }>(pool, `SELECT to_jsonb(t)::text AS row FROM (SELECT ${columns.map(identifier).join(",")} FROM public.${identifier(table)}) t ORDER BY to_jsonb(t)::text`, [], signal);
    const hash = createHash("sha256");
    for (const row of rows.rows) hash.update(row.row).update("\n");
    // Only counts/digests and public column names leave this function. Even a failed
    // equality assertion cannot print token ciphertext, password hashes or message bodies.
    snapshot[table] = { columns, count: rows.rows.length, hash: hash.digest("hex") };
  }
  return snapshot;
}

export async function assertQualificationJournal(pool: Pool, source: QualificationSources, signal: AbortSignal): Promise<void> {
  const rows = await query<{ hash: string; created_at: string }>(pool, "SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id", [], signal);
  expect(rows.rows).toEqual(source.hashes.map((entry) => ({ hash: entry.hash, created_at: String(entry.when) })));
}

export type QualificationGuardSet = Record<string, string>;

export async function captureQualificationGuardSet(pool: Pool, signal: AbortSignal): Promise<QualificationGuardSet> {
  const result = await query<{ key: string; definition: string }>(pool, `SELECT key,definition FROM (
    SELECT 'constraint:public.' || c.relname || ':' || con.conname AS key,pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid WHERE con.connamespace='public'::regnamespace
    UNION ALL SELECT 'index:public.' || tablename || ':' || indexname,indexdef FROM pg_indexes WHERE schemaname='public'
    UNION ALL SELECT 'trigger:public.' || c.relname || ':' || t.tgname,pg_get_triggerdef(t.oid) || ':enabled=' || t.tgenabled
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relnamespace='public'::regnamespace
    UNION ALL SELECT 'function:public:' || proname || '(' || pg_get_function_identity_arguments(oid) || ')',pg_get_functiondef(oid)
      FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='workflow_version_immutable'
  ) definitions ORDER BY key`, [], signal);
  expect(new Set(result.rows.map((row) => row.key)).size).toBe(result.rows.length);
  return Object.fromEntries(result.rows.map((row) => [row.key,row.definition]));
}

export function assertQualificationBaselineGuards(before: QualificationGuardSet, after: QualificationGuardSet): void {
  // Migration85 replaces one mailbox per owner with a partial default index.
  const replaced = new Set([
    "constraint:public.email_accounts:email_accounts_user_id_unique",
    "index:public.email_accounts:email_accounts_user_id_unique",
  ]);
  for (const [key,definition] of Object.entries(before)) {
    if (replaced.has(key)) expect(after[key]).toBeUndefined();
    else expect({key,definition:after[key]}).toEqual({key,definition});
  }
}

export async function captureQualificationGuards(pool: Pool, signal: AbortSignal): Promise<string> {
  return createHash("sha256").update(JSON.stringify(await captureQualificationGuardSet(pool,signal))).digest("hex");
}
