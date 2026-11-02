import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { AppError, ERROR_IDS } from "@/constants/errorIds";

const migrationUrl = new URL("../../../drizzle/0101_deal_write_version.sql", import.meta.url);

type FixtureState = {
  columnPresent: boolean;
  columnReady: boolean;
  functionPresent: boolean;
  triggerPresent: boolean;
  triggerReady: boolean;
};

async function fixtureState(client: PoolClient): Promise<FixtureState> {
  const result = await client.query<FixtureState>(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute
        WHERE attrelid = 'public.deals'::regclass
          AND attname = 'write_version' AND NOT attisdropped
      ) AS "columnPresent",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_attribute AS a
        JOIN pg_catalog.pg_attrdef AS d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.deals'::regclass
          AND a.attname = 'write_version' AND NOT a.attisdropped
          AND a.attnotnull AND a.atttypid = 'pg_catalog.uuid'::regtype
          AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) IN (
            'gen_random_uuid()', 'pg_catalog.gen_random_uuid()'
          )
      ) AS "columnReady",
      to_regprocedure('public.assign_deal_write_version()') IS NOT NULL AS "functionPresent",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.deals'::regclass AND tgname = 'deals_write_version_owned'
          AND NOT tgisinternal
      ) AS "triggerPresent",
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.deals'::regclass AND tgname = 'deals_write_version_owned'
          AND NOT tgisinternal AND tgenabled IN ('O', 'A') AND tgtype = 23
          AND tgfoid = to_regprocedure('public.assign_deal_write_version()')
      ) AS "triggerReady"
  `);
  const state = result.rows[0];
  if (state === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "deal write-version fixture state is missing");
  return state;
}

// Temporary fixture overlay while reserved migrations 0098–0100 are not present in
// this private checkout. Do not append an out-of-order canonical journal entry or
// manufacture a migration receipt. The integrator reconciles the canonical history.
// Idempotence is for owned fixtures only; this is not installed-history admission.
export async function installDealWriteVersionFixture(pool: Pool): Promise<void> {
  const source = await readFile(migrationUrl, "utf8");
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL search_path = pg_catalog, public");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('warpdrive:test:deal-write-version:0101'))",
    );
    const state = await fixtureState(client);
    if (state.columnReady && state.functionPresent && state.triggerReady) {
      await client.query("COMMIT");
      return;
    }
    if (state.columnPresent || state.functionPresent || state.triggerPresent) {
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "refusing a partial deal write-version fixture installation",
      );
    }
    await client.query(source);
    const installed = await fixtureState(client);
    if (!installed.columnReady || !installed.functionPresent || !installed.triggerReady) {
      throw new AppError(
        ERROR_IDS.DB_INVARIANT,
        "deal write-version fixture installation is incomplete",
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      discard = true;
      throw new AggregateError([error, rollbackError], "deal version fixture rollback failed");
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
