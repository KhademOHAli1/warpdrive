import { sql } from "drizzle-orm";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters } from "@/types/stats";
import { dealMetricPopulation, visibleDealPopulation } from "./dealPopulation";
import { resolveLostReasonSelection } from "./lostReasonSelection";
import type { DealRecordMetric } from "./metricDictionary";
import { wonTrendMonthPopulation } from "./wonTrend";

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
  reasonReconciles: boolean;
  rows: DealReportRecord[];
}

interface RecordsInput {
  metric: DealRecordMetric;
  limit: number;
  cursor?: DealRecordsCursor;
  wonMonth?: string;
  lostReason?: string;
}

function recordsPopulation(actor: PermSetUser, filters: DashboardFilters, input: RecordsInput) {
  if (input.lostReason !== undefined) {
    const reason = resolveLostReasonSelection(input.lostReason, actor.id, filters);
    if (reason === null || input.metric !== "lost" || input.wonMonth !== undefined)
      throw new AppError(ERROR_IDS.DEAL_FILTER_INVALID, "Lost reason selection is unavailable");
    return {
      population: sql`(${dealMetricPopulation("lost", filters)}) AND (${reason.predicate})`,
      legacy: reason.legacy,
    };
  }
  const population =
    input.wonMonth === undefined
      ? dealMetricPopulation(input.metric, filters)
      : input.metric === "won"
        ? wonTrendMonthPopulation(filters, input.wonMonth)
        : sql`false`;
  return { population, legacy: false };
}

// One statement gives the page and complete-population totals the same MVCC snapshot.
// Every subsequent page rechecks the *viewer*, never a creator's cached record IDs.
// This is a live read; immutable historical reporting requires a separate snapshot store.
export async function dealRecords(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  input: RecordsInput,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { population, legacy } = recordsPopulation(actor, filters, input);
  const visible = await visibleDealPopulation(db, actor, filters, signal);
  const cursor =
    input.cursor === undefined
      ? sql`true`
      : sql`(created_at, id) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`;
  const legacyProjection = legacy ? sql`, d.lost_reason AS legacy_reason` : sql``;
  // Only one raw legacy group may match the sealed digest. Raw text stays in PostgreSQL.
  const reasonCheck = legacy
    ? sql`min(legacy_reason COLLATE pg_catalog."C") IS NOT DISTINCT FROM max(legacy_reason COLLATE pg_catalog."C")`
    : sql`true`;
  const result = await db
    .execute(sql`
    WITH eligible AS MATERIALIZED (
      SELECT d.id, d.title, d.status, d.value, d.currency, d.created_at,
        CASE WHEN d.status = 'won' THEN d.won_time WHEN d.status = 'lost' THEN d.lost_time ELSE NULL END AS closed_at
        ${legacyProjection}
      FROM deals d JOIN pipelines p ON p.id = d.pipeline_id
      WHERE ${visible} AND (${population})
    ), page AS (
      SELECT * FROM eligible WHERE ${cursor}
      ORDER BY created_at DESC, id DESC LIMIT ${input.limit + 1}
    )
    SELECT count(*)::int AS count, coalesce(sum(value), 0)::text AS value,
      count(value)::int AS "valueCount",
      (${reasonCheck}) AS "reasonReconciles",
      (SELECT coalesce(json_agg(json_build_object(
        'id', id, 'title', title, 'status', status,
        'value', value::text, 'currency', currency,
        'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'closedAt', to_char(closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) ORDER BY created_at DESC, id DESC), '[]'::json) FROM page) AS rows
    FROM eligible
  `)
    .catch((error: unknown) => {
      // Drizzle errors can contain bound values. Keep the unsealed digest off error surfaces.
      if (legacy) throw new AppError(ERROR_IDS.DB_READ_FAILED, "Lost reason report read failed");
      throw error;
    });
  signal.throwIfAborted();
  const row = (result as unknown as { rows: QueryRow[] }).rows[0];
  if (row === undefined)
    throw new AppError(ERROR_IDS.DB_READ_FAILED, "Deal report aggregate returned no row");
  if (!row.reasonReconciles)
    throw new AppError(ERROR_IDS.DEAL_FILTER_INVALID, "Lost reason selection is unavailable");
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
