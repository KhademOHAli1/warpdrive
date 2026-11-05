import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters } from "@/types/stats";
import { dealMetricPopulation, visibleDealPopulation } from "./dealPopulation";
import type { DealRecordMetric } from "./metricDictionary";

export interface DealRecordsCursor {
  createdAt: string;
  id: string;
}
export interface DealReportRecord {
  id: string;
  title: string;
  status: "open" | "won" | "lost";
  value: string | null;
  currency: string;
  createdAt: string;
  closedAt: string | null;
}

interface QueryRow {
  count: number;
  value: string;
  valueCount: number;
  rows: DealReportRecord[];
}

// One statement gives the page and complete-population totals the same MVCC snapshot.
// Every subsequent page rechecks the *viewer*, never a creator's cached record IDs.
// This is a live read; immutable historical reporting requires a separate snapshot store.
export async function dealRecords(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  input: { metric: DealRecordMetric; limit: number; cursor?: DealRecordsCursor },
  signal: AbortSignal,
) {
  const visible = await visibleDealPopulation(db, actor, filters, signal);
  const population = dealMetricPopulation(input.metric, filters);
  const cursor =
    input.cursor === undefined
      ? sql`true`
      : sql`(created_at, id) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`;
  const result = await db.execute(sql`
    WITH eligible AS MATERIALIZED (
      SELECT d.id, d.title, d.status, d.value, d.currency, d.created_at,
        CASE WHEN d.status = 'won' THEN d.won_time WHEN d.status = 'lost' THEN d.lost_time ELSE NULL END AS closed_at
      FROM deals d JOIN pipelines p ON p.id = d.pipeline_id
      WHERE ${visible} AND (${population})
    ), page AS (
      SELECT * FROM eligible WHERE ${cursor}
      ORDER BY created_at DESC, id DESC LIMIT ${input.limit + 1}
    )
    SELECT count(*)::int AS count, coalesce(sum(value), 0)::text AS value,
      count(value)::int AS "valueCount",
      (SELECT coalesce(json_agg(json_build_object(
        'id', id, 'title', title, 'status', status,
        'value', value::text, 'currency', currency,
        'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'closedAt', to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) ORDER BY created_at DESC, id DESC), '[]'::json) FROM page) AS rows
    FROM eligible
  `);
  signal.throwIfAborted();
  const row = (result as unknown as { rows: QueryRow[] }).rows[0];
  if (row === undefined) throw new Error("Deal report aggregate returned no row");
  const rows = row.rows.slice(0, input.limit).map((record) => ({
    ...record,
    value: record.value === null ? null : canonicalMoney(record.value),
  }));
  const last = rows.at(-1);
  return {
    rows,
    totals: { count: row.count, value: canonicalMoney(row.value), valueCount: row.valueCount },
    // Retain microseconds in the cursor; JS Date would truncate a PostgreSQL timestamp.
    nextCursor:
      row.rows.length > input.limit && last !== undefined
        ? { createdAt: last.createdAt, id: last.id }
        : null,
  };
}
