import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import type { CanonicalMigration } from "./migrationAdmission";
import {
  type MailFunctionProtection,
  type MailPointerProtection,
  type MailTriggerProtection,
  readMailProtections,
} from "./migrationAdmissionMailSource";

type MigrationExecutor = Pick<NodePgDatabase<Record<string, unknown>>, "execute">;
const singleBoolean = z.tuple([z.object({ present: z.boolean() })]);

async function functionPresent(
  db: MigrationExecutor,
  spec: MailFunctionProtection,
  signal: AbortSignal,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE n.nspname = 'public' AND p.proname = ${spec.name} AND p.prokind = 'f'
        AND pg_catalog.pg_get_function_arguments(p.oid) = ${spec.arguments}
        AND pg_catalog.pg_get_function_result(p.oid) = ${spec.returns}
        AND l.lanname = ${spec.language} AND p.prosrc = ${spec.body}
        AND p.provolatile = ${spec.volatility} AND p.proisstrict = ${spec.strict}
        AND p.proparallel = ${spec.parallel} AND p.prosecdef = ${spec.definer}
        AND p.proconfig = ARRAY[${spec.config}]
    ) AS present`);
  signal.throwIfAborted();
  const parsed = singleBoolean.safeParse(result.rows);
  return parsed.success && parsed.data[0].present;
}

async function triggerPresent(
  db: MigrationExecutor,
  spec: MailTriggerProtection,
  signal: AbortSignal,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgname = ${spec.name} AND NOT t.tgisinternal
        AND t.tgrelid = pg_catalog.to_regclass(${`public.${spec.table}`})
        AND t.tgfoid = pg_catalog.to_regprocedure(${`public.${spec.function}()`})
        AND t.tgenabled = 'O' AND t.tgtype = ${spec.type}
        AND t.tgqual IS NULL AND t.tgattr = ''::pg_catalog.int2vector
        AND t.tgnargs = 0 AND t.tgargs = ''::pg_catalog.bytea
        AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgconstraint = 0
    ) AS present`);
  signal.throwIfAborted();
  const parsed = singleBoolean.safeParse(result.rows);
  return parsed.success && parsed.data[0].present;
}

async function pointerPresent(
  db: MigrationExecutor,
  spec: MailPointerProtection,
  signal: AbortSignal,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conname = ${spec.name} AND c.contype = 'f' AND c.convalidated
        AND c.conrelid = pg_catalog.to_regclass(${`public.${spec.table}`})
        AND c.confrelid = pg_catalog.to_regclass(${`public.${spec.target}`})
        AND NOT c.condeferrable AND NOT c.condeferred
        AND c.confmatchtype = 's' AND c.confupdtype = 'a' AND c.confdeltype = 'n'
        AND (SELECT count(*) FROM pg_catalog.pg_trigger t
          WHERE t.tgconstraint = c.oid AND t.tgisinternal) = 4
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
          WHERE t.tgconstraint = c.oid AND t.tgisinternal AND t.tgenabled <> 'O')
        AND ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(c.conkey) WITH ORDINALITY k(num, pos)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num
          ORDER BY k.pos) = ARRAY[${spec.pointer}, 'account_id']
        AND ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(c.confkey) WITH ORDINALITY k(num, pos)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num
          ORDER BY k.pos) = ARRAY['id', 'account_id']
        AND ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(c.confdelsetcols) WITH ORDINALITY k(num, pos)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num
          ORDER BY k.pos) = ARRAY[${spec.pointer}]
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attname = 'account_id'
            AND a.attnotnull AND NOT a.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = c.conrelid AND a.attname = ${spec.pointer}
            AND NOT a.attnotnull AND NOT a.attisdropped)
    ) AS present`);
  signal.throwIfAborted();
  const parsed = singleBoolean.safeParse(result.rows);
  return parsed.success && parsed.data[0].present;
}

// Bounded Mail evidence protections, not a full physical schema fingerprint.
// Call with only the admitted prefix before execution and the full prefix after execution.
export async function verifyMailMigrations(
  db: MigrationExecutor,
  canonical: readonly CanonicalMigration[],
  signal: AbortSignal,
): Promise<Result<true, string>> {
  const source = readMailProtections(canonical);
  if (!source.ok) return source;
  for (const spec of source.value.functions)
    if (!(await functionPresent(db, spec, signal)))
      return err("canonical mail integrity checks failed");
  for (const spec of source.value.triggers)
    if (!(await triggerPresent(db, spec, signal)))
      return err("canonical mail integrity checks failed");
  for (const spec of source.value.pointers)
    if (!(await pointerPresent(db, spec, signal)))
      return err("canonical mail integrity checks failed");
  return ok(true);
}
