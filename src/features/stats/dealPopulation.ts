import { type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { reportCurrencyClause } from "@/features/currencies/reportCurrency";
import { dealVisibilityClause } from "@/features/deals/visibility";
import type { PermSetUser } from "@/features/permissions/effective";
import type { DashboardFilters } from "@/types/stats";
import type { DealRecordMetric } from "./metricDictionary";
import { ownerFilterClause } from "./ownerIds";
import { reportPeriod } from "./reportPeriod";

// All fragments require FROM deals d JOIN pipelines p ON p.id = d.pipeline_id.
// Owner/reporting permission and row visibility are independent gates.
export async function visibleDealPopulation(
  db: Db,
  actor: PermSetUser,
  filters: DashboardFilters,
  signal: AbortSignal,
): Promise<SQL> {
  signal.throwIfAborted();
  const currency = await reportCurrencyClause(db, filters.currency, signal);
  const visibility = dealVisibilityClause({
    userId: actor.id,
    isAdmin: actor.type === "admin",
    isActive: actor.isActive,
    sessionLive: true,
    visibilityGroupIds: Array.from(actor.groupIds),
    managedUserIds: Array.from(actor.managedUserIds ?? []),
  });
  const owners = ownerFilterClause(sql`d.owner_id`, filters.owners);
  const pipeline =
    filters.pipelineId === null ? sql`` : sql`AND d.pipeline_id = ${filters.pipelineId}`;
  return sql`d.deleted_at IS NULL AND d.archived_at IS NULL AND p.is_archived = false
    ${currency} ${owners} ${pipeline} AND ${visibility}`;
}

export function dealMetricPopulation(metric: DealRecordMetric, filters: DashboardFilters): SQL {
  const period = reportPeriod(filters);
  const won = sql`d.status = 'won' AND d.won_time >= ${period.from} AND d.won_time < ${period.toExclusive}`;
  const lost = sql`d.status = 'lost' AND d.lost_time >= ${period.from} AND d.lost_time < ${period.toExclusive}`;
  switch (metric) {
    case "added":
      return sql`d.created_at >= ${period.from} AND d.created_at < ${period.toExclusive}`;
    case "won":
      return won;
    case "wonValue":
      return sql`(${won}) AND d.value IS NOT NULL`;
    case "wonCycle":
      return sql`(${won}) AND d.won_time >= d.created_at`;
    case "lost":
      return lost;
    case "closed":
      return sql`((${won}) OR (${lost}))`;
    case "open":
      return sql`d.status = 'open'`;
  }
}
