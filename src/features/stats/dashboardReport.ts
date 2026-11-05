import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import type { PermSetUser } from "@/features/permissions/effective";
import { activitiesByType } from "./activitiesByType";
import { activitiesPerformance } from "./activitiesPerformance";
import { aggregateStageConversion, aggregateStageSums } from "./aggregateStages";
import { dealPerformance } from "./dealPerformance";
import { lostReasonBreakdown } from "./lostReasons";
import type { resolveReportScope } from "./resolveReportScope";
import { stageConversion } from "./stageConversion";
import { stageSums } from "./stageSums";
import { visiblePipelineIds } from "./visiblePipelines";
import { winRate } from "./winRate";
import { wonDealStats } from "./wonDealStats";
import { wonTrend } from "./wonTrend";

const MAX_SAVED_RERUN_PIPELINES = 50;

type ResolvedScope = Awaited<ReturnType<typeof resolveReportScope>>;

function readScheduler(serial: boolean) {
  let tail: Promise<unknown> = Promise.resolve();
  return function schedule<T>(read: () => Promise<T>): Promise<T> {
    if (!serial) return read();
    const current = tail.then(read);
    tail = current;
    return current;
  };
}

/** Uses the same metrics for the ad hoc dashboard and the exact saved report. */
export async function calculateDashboardReport(
  db: Db,
  actor: PermSetUser,
  { currency, effectiveOwnerScope, filters }: ResolvedScope,
  signal: AbortSignal,
  execution: "parallel" | "snapshot" = "parallel",
) {
  const serial = execution === "snapshot";
  const visibleLimit = serial ? MAX_SAVED_RERUN_PIPELINES + 1 : undefined;
  const stagePipelineIds =
    filters.pipelineId === null
      ? await visiblePipelineIds(db, actor, signal, visibleLimit)
      : [filters.pipelineId];
  if (serial && stagePipelineIds.length > MAX_SAVED_RERUN_PIPELINES)
    throw new AppError(ERROR_IDS.DB_READ_FAILED, "Saved Performance pipeline limit exceeded");

  // The ad hoc dashboard retains parallel pool reads. A snapshot owns one client,
  // so each calculation waits for the preceding one on that client.
  const run = readScheduler(serial);
  const [dp, ap, wds, abt, lrb, trend, perPipelineFunnel, perPipelineSums] = await Promise.all([
    run(() => dealPerformance(db, actor, filters, signal)),
    run(() => activitiesPerformance(db, actor, filters, signal)),
    run(() => wonDealStats(db, actor, filters, signal)),
    run(() => activitiesByType(db, actor, filters, signal)),
    run(() => lostReasonBreakdown(db, actor, filters, signal)),
    run(() => wonTrend(db, actor, filters, signal)),
    Promise.all(
      stagePipelineIds.map((pipelineId) =>
        run(() => stageConversion(db, actor, { ...filters, pipelineId }, signal)),
      ),
    ),
    Promise.all(
      stagePipelineIds.map((pipelineId) =>
        run(() => stageSums(db, actor, pipelineId, filters.owners, signal, currency)),
      ),
    ),
  ]);
  signal.throwIfAborted();

  return {
    currency,
    timeZone: filters.timeZone ?? "UTC",
    dealPerformance: dp,
    winRate: winRate(dp.won, dp.lost),
    wonDealStats: wds,
    wonTrend: trend,
    funnel: aggregateStageConversion(perPipelineFunnel),
    activities: ap,
    activitiesByType: abt,
    lostReasons: lrb,
    stageSums: aggregateStageSums(perPipelineSums),
    effectiveOwnerScope,
  };
}
