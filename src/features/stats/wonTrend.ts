// Won deal count and value per month across the dashboard range. The only stats query that
// answers "which way is this going" rather than "where does it rest right now".
// Windows on won_time (see dealPerformance for why) and applies dealVisibilityClause.

import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters, WonTrendPoint } from "@/types/stats";
import { dealMetricPopulation, visibleDealPopulation } from "./dealPopulation";
import { monthsInRange, windowStart } from "./monthBuckets";

function trendWindow(filters: DashboardFilters) {
  const months = monthsInRange(filters.from, filters.to);
  const from = windowStart(filters.from, months);
  return from === null ? null : { months, filters: { ...filters, from } };
}

function wonMonthBucket(timeZone = "UTC") {
  return sql`to_char(date_trunc('month', d.won_time AT TIME ZONE ${timeZone}), 'YYYY-MM')`;
}

/** A bucket is the original capped chart window plus the chart's exact local-month group. */
export function wonTrendMonthPopulation(filters: DashboardFilters, month: string) {
  const window = trendWindow(filters);
  if (window === null || !window.months.includes(month)) return sql`false`;
  return sql`(${dealMetricPopulation("won", window.filters)})
    AND ${wonMonthBucket(filters.timeZone)} = ${month}`;
}

interface Row {
  month: string;
  count: number;
  value: string;
}

export async function wonTrend(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  signal: AbortSignal,
): Promise<WonTrendPoint[]> {
  signal.throwIfAborted();
  const window = trendWindow(filters);
  if (window === null) return [];
  const visible = await visibleDealPopulation(db, actor, window.filters, signal);
  const population = dealMetricPopulation("won", window.filters);

  const result = await db.execute(sql`
    SELECT
      ${wonMonthBucket(filters.timeZone)} AS "month",
      count(*)::int AS "count",
      coalesce(sum(d.value), 0)::text AS "value"
    FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id
    WHERE ${visible} AND (${population})
    GROUP BY 1
  `);

  signal.throwIfAborted();

  const byMonth = new Map<string, Row>();
  for (const row of (result as unknown as { rows: Row[] }).rows) byMonth.set(row.month, row);

  return window.months.map((month) => {
    const row = byMonth.get(month);
    return {
      month,
      count: row?.count ?? 0,
      value: canonicalMoney(row?.value ?? "0.00"),
    };
  });
}
