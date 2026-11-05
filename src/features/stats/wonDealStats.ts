// Average and median size of deals won in the range, plus how long they took to win.
// One scan over the same set for both, since "the deals won in this period" is the only
// population either metric cares about.
// Windows on won_time (see dealPerformance for why), and applies dealVisibilityClause.

import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters, WonDealStats } from "@/types/stats";
import { dealMetricPopulation, visibleDealPopulation } from "./dealPopulation";

interface Row {
  avgValue: string | null;
  medianValue: string | null;
  avgCycleDays: number | null;
  medianCycleDays: number | null;
}

export async function wonDealStats(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  signal: AbortSignal,
): Promise<WonDealStats> {
  signal.throwIfAborted();

  const visible = await visibleDealPopulation(db, actor, filters, signal);
  const won = dealMetricPopulation("won", filters);

  // Every aggregate is null over an empty set, which is exactly the distinction the UI needs:
  // "no deals won" must not render as an average of zero.
  const result = await db.execute(sql`
    SELECT
      avg(d.value)::numeric(18,4)::text AS "avgValue",
      (
        ((array_agg(d.value ORDER BY d.value) FILTER (WHERE d.value IS NOT NULL))[(count(d.value) + 1) / 2]
        + (array_agg(d.value ORDER BY d.value) FILTER (WHERE d.value IS NOT NULL))[(count(d.value) + 2) / 2]) / 2
      )::numeric(18,4)::text AS "medianValue",
      (avg(extract(epoch FROM (d.won_time - d.created_at)) / 86400)
        FILTER (WHERE d.won_time >= d.created_at))::float8 AS "avgCycleDays",
      (percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (d.won_time - d.created_at)) / 86400
      ) FILTER (WHERE d.won_time >= d.created_at))::float8 AS "medianCycleDays"
    FROM deals d
    JOIN pipelines p ON p.id = d.pipeline_id
    WHERE ${visible} AND (${won})
  `);

  signal.throwIfAborted();

  const row = (result as unknown as { rows: Row[] }).rows[0];
  return {
    avgValue: row?.avgValue == null ? null : canonicalMoney(row.avgValue),
    medianValue: row?.medianValue == null ? null : canonicalMoney(row.medianValue),
    avgCycleDays: row?.avgCycleDays ?? null,
    medianCycleDays: row?.medianCycleDays ?? null,
  };
}
