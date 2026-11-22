import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { inventoryEngineeringChanges as changes } from "./schema";

async function engineeringSchemaStatus(tx: Db) {
  const result = await tx.execute<{ available: boolean; milliseconds: string }>(sql`
    SELECT to_regclass('inventory_engineering_changes') IS NOT NULL AS available,
      (extract(epoch FROM clock_timestamp()) * 1000)::text AS milliseconds
  `);
  const status = result.rows[0];
  if (status === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Engineering schema clock unavailable");
  return {
    available: status.available,
    observedAt: new Date(Number(status.milliseconds)).toISOString(),
  };
}

export async function engineeringSchemaAvailable(tx: Db) {
  return (await engineeringSchemaStatus(tx)).available;
}

async function readPolicies(tx: Db, itemIds: readonly string[]) {
  const targets = sql.join(
    Array.from(new Set(itemIds), (id) => sql`${id}`),
    sql`, `,
  );
  const policy = await tx.execute<{
    itemId: string | null;
    releaseId: string | null;
    milliseconds: string;
  }>(sql`
    WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS at),
    baseline AS (
      SELECT DISTINCT ON (c.item_id) c.item_id, c.base_release_id
      FROM ${changes} c
      WHERE c.item_id IN (${targets}) AND c.status <> 'withdrawn'
      ORDER BY c.item_id, c.created_at, c.id
    ), effective AS (
      SELECT DISTINCT ON (c.item_id) c.item_id, c.candidate_release_id
      FROM ${changes} c CROSS JOIN tick
      WHERE c.item_id IN (${targets}) AND c.status = 'approved' AND c.effective_at <= tick.at
      ORDER BY c.item_id, c.effective_at DESC, c.id DESC
    )
    SELECT baseline.item_id AS "itemId",
      coalesce(effective.candidate_release_id, baseline.base_release_id) AS "releaseId",
      (extract(epoch FROM tick.at) * 1000)::text AS milliseconds
    FROM tick LEFT JOIN baseline ON true LEFT JOIN effective ON effective.item_id = baseline.item_id
  `);
  const row = policy.rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Engineering policy clock unavailable");
  return {
    releaseIds: new Map(
      policy.rows.flatMap(({ itemId, releaseId }) =>
        itemId === null || releaseId === null ? [] : [[itemId, releaseId]],
      ),
    ),
    observedAt: new Date(Number(row.milliseconds)).toISOString(),
  };
}

/** Writers call after locking the product, taking the cutover clock after any lock wait. */
export async function readEngineeringReleasePolicy(tx: Db, itemId: string) {
  const status = await engineeringSchemaStatus(tx);
  if (!status.available) return { ...status, managed: false, releaseId: null };
  const { releaseIds, observedAt } = await readPolicies(tx, [itemId]);
  const releaseId = releaseIds.get(itemId) ?? null;
  return { available: true, managed: releaseId !== null, releaseId, observedAt };
}

export async function readManagedEngineeringReleases(tx: Db, itemIds: readonly string[]) {
  return itemIds.length === 0 || !(await engineeringSchemaAvailable(tx))
    ? new Map<string, string>()
    : (await readPolicies(tx, itemIds)).releaseIds;
}
