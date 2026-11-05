// Stats tRPC router: dashboard procedure.
// Security gate: resolves effective ownerScope server-side (never trusts client claim), and
// runs every stage-based query behind visiblePipelines so a restricted pipeline's stage names
// never reach a user who cannot see that pipeline. That applies to the "All pipelines"
// aggregate as much as to a single selected pipeline.

import { listTeams } from "@/features/identity/teams.service";
import { listAssignableUsers } from "@/features/identity/users.service";
import { can } from "@/features/permissions/can";
import { activitiesByType } from "@/features/stats/activitiesByType";
import { activitiesPerformance } from "@/features/stats/activitiesPerformance";
import { aggregateStageConversion, aggregateStageSums } from "@/features/stats/aggregateStages";
import { dealPerformance } from "@/features/stats/dealPerformance";
import { lostReasonBreakdown } from "@/features/stats/lostReasons";
import { stageConversion } from "@/features/stats/stageConversion";
import { stageSums } from "@/features/stats/stageSums";
import { visiblePipelineIds } from "@/features/stats/visiblePipelines";
import { winRate } from "@/features/stats/winRate";
import { wonDealStats } from "@/features/stats/wonDealStats";
import { wonTrend } from "@/features/stats/wonTrend";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { dealRecords } from "./dealRecords";
import { ANALYTICS_METRIC_DICTIONARY_VERSION } from "./metricDictionary";
import { resolveReportScope } from "./resolveReportScope";
import { dashboardInput, dealRecordsInput } from "./schemas";

// Module-local abort-signal factory: mirrors the pattern in notifications/router.ts.
const SIG = (): AbortSignal => AbortSignal.timeout(15_000);

export const statsRouter = router({
  dashboard: protectedProcedure.input(dashboardInput).query(async ({ ctx, input }) => {
    const signal = SIG();
    const { currency, effectiveOwnerScope, filters } = await resolveReportScope(
      ctx.db,
      ctx.actor,
      input,
      signal,
    );
    const requested = input.pipelineId;
    const owners = filters.owners;

    // Stage-based queries are inherently per pipeline: either the one selected, or every
    // visible one merged by stage position for the "All pipelines" view.
    const stagePipelineIds =
      requested !== null ? [requested] : await visiblePipelineIds(ctx.db, ctx.actor, signal);

    const [dp, ap, wds, abt, lrb, trend, perPipelineFunnel, perPipelineSums] = await Promise.all([
      dealPerformance(ctx.db, ctx.actor, filters, signal),
      activitiesPerformance(ctx.db, ctx.actor, filters, signal),
      wonDealStats(ctx.db, ctx.actor, filters, signal),
      activitiesByType(ctx.db, ctx.actor, filters, signal),
      lostReasonBreakdown(ctx.db, ctx.actor, filters, signal),
      wonTrend(ctx.db, ctx.actor, filters, signal),
      Promise.all(
        stagePipelineIds.map((pipelineId) =>
          stageConversion(ctx.db, ctx.actor, { ...filters, pipelineId }, signal),
        ),
      ),
      Promise.all(
        stagePipelineIds.map((pipelineId) =>
          stageSums(ctx.db, ctx.actor, pipelineId, owners, signal, currency),
        ),
      ),
    ]);

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
  }),

  records: protectedProcedure.input(dealRecordsInput).query(async ({ ctx, input }) => {
    const signal = SIG();
    const { currency, effectiveOwnerScope, filters } = await resolveReportScope(
      ctx.db,
      ctx.actor,
      input,
      signal,
    );
    const result = await dealRecords(ctx.db, ctx.actor, filters, input, signal);
    return {
      ...result,
      currency,
      effectiveOwnerScope,
      metric: input.metric,
      definitionVersion: ANALYTICS_METRIC_DICTIONARY_VERSION,
      timeZone: filters.timeZone ?? "UTC",
      generatedAt: new Date().toISOString(),
    };
  }),

  ownerOptions: protectedProcedure.query(async ({ ctx }) => {
    if (!can(ctx.actor, "stats.viewOthers")) return { users: [], teams: [] };
    const signal = SIG();
    const [users, teamRows] = await Promise.all([
      listAssignableUsers(ctx.db, signal),
      listTeams(ctx.db, signal),
    ]);
    return { users, teams: teamRows.map((t) => ({ id: t.id, name: t.name })) };
  }),
});
