// Average and median size of deals won in the range, plus how long they took to win.
// One scan over the same set for both, since "the deals won in this period" is the only
// population either metric cares about.
// Windows on won_time (see dealPerformance for why), and applies dealVisibilityClause.
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { reportCurrencyClause } from "@/features/currencies/reportCurrency";
import { dealVisibilityClause } from "@/features/deals/visibility";
import type { PermSetUser } from "@/features/permissions/effective";
import { ownerFilterClause } from "@/features/stats/ownerIds";
import { canonicalMoney } from "@/lib/canonicalMoney";
import type { DashboardFilters, WonDealStats } from "@/types/stats";

function toSession(actor: PermSetUser) {
  return {
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    visibilityGroupIds: Array.from(actor.groupIds),
    managedUserIds: Array.from(actor.managedUserIds ?? []),
  };
}

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

  const currencyClause = await reportCurrencyClause(db, filters.currency, signal);
  const visClause = dealVisibilityClause(toSession(actor));
  const ownerClause = ownerFilterClause(sql`d.owner_id`, filters.owners);
  const pipelineClause =
    filters.pipelineId !== null ? sql`AND d.pipeline_id = ${filters.pipelineId}` : sql``;

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
    WHERE d.deleted_at IS NULL
      AND d.archived_at IS NULL
      AND p.is_archived = false
      AND d.status = 'won'
      AND d.won_time >= ${filters.from}::date
      AND d.won_time < ${filters.to}::date + INTERVAL '1 day'
      ${pipelineClause}
      ${ownerClause}
      ${currencyClause}
      AND ${visClause}
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
