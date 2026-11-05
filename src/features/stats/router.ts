// Stats tRPC router: dashboard procedure.
// Security gate: resolves effective ownerScope server-side (never trusts client claim), and
// runs every stage-based query behind visiblePipelines so a restricted pipeline's stage names
// never reach a user who cannot see that pipeline. That applies to the "All pipelines"
// aggregate as much as to a single selected pipeline.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { guardCsrf } from "@/features/identity/actions/shared";
import { listTeams } from "@/features/identity/teams.service";
import { listAssignableUsers } from "@/features/identity/users.service";
import { can } from "@/features/permissions/can";
import { protectedProcedure, router } from "@/server/trpc/trpc";
import { analyticsAttentionInput, readAnalyticsAttention } from "./analyticsAttention";
import {
  currentAccountConcentrationInput,
  readCurrentAccountConcentrationReport,
} from "./currentAccountConcentrationReport";
import { readCurrentLeadHandoffReport } from "./currentLeadHandoffReport";
import { calculateDashboardReport } from "./dashboardReport";
import { dealRecords } from "./dealRecords";
import { readCurrentStageAgingView } from "./history/currentStageAgingRepository";
import { readObservedDealWinCohorts } from "./history/dealCohortRepository";
import { dealWinCohortHorizon, dealWinCohortView } from "./history/dealWinCohortView";
import { ANALYTICS_METRIC_DICTIONARY_VERSION } from "./metricDictionary";
import { nativePeriodForecastInput, readNativePeriodForecast } from "./nativePeriodForecast";
import { readRecordedDealSourceReport } from "./recordedDealSourceReport";
import { resolveReportScope } from "./resolveReportScope";
import { rerunSavedPerformanceReport, savedPerformanceRerunInput } from "./savedPerformanceRerun";
import { savedPerformanceRouter } from "./savedPerformanceRouter";
import { dashboardInput, dealRecordsInput, dealWinCohortsInput, stageAgingInput } from "./schemas";

// Module-local abort-signal factory: mirrors the pattern in notifications/router.ts.
const SIG = (): AbortSignal => AbortSignal.timeout(15_000);

export const statsRouter = router({
  savedPerformance: savedPerformanceRouter,
  dashboard: protectedProcedure.input(dashboardInput).query(async ({ ctx, input }) => {
    const signal = SIG();
    const scope = await resolveReportScope(ctx.db, ctx.actor, input, signal, ctx.localeFallback);
    return calculateDashboardReport(ctx.db, ctx.actor, scope, signal);
  }),

  savedPerformanceRerun: protectedProcedure
    .input(savedPerformanceRerunInput)
    .query(({ ctx, input }) =>
      rerunSavedPerformanceReport(
        ctx.db,
        { actor: ctx.actor, session: ctx.session },
        input,
        SIG(),
        ctx.localeFallback,
      ),
    ),

  records: protectedProcedure.input(dealRecordsInput).query(async ({ ctx, input }) => {
    const signal = SIG();
    const { currency, effectiveOwnerScope, filters } = await resolveReportScope(
      ctx.db,
      ctx.actor,
      input,
      signal,
      ctx.localeFallback,
    );
    const result = await dealRecords(ctx.db, ctx.actor, filters, input, signal);
    return {
      ...result,
      currency,
      effectiveOwnerScope,
      metric: input.metric,
      ...(input.wonMonth === undefined ? {} : { wonMonth: input.wonMonth }),
      definitionVersion: ANALYTICS_METRIC_DICTIONARY_VERSION,
      timeZone: filters.timeZone ?? "UTC",
      generatedAt: new Date().toISOString(),
    };
  }),

  recordedDealSource: protectedProcedure
    .input(dashboardInput)
    .query(({ ctx, input }) =>
      readRecordedDealSourceReport(ctx.db, ctx.actor, input, SIG(), ctx.localeFallback),
    ),

  currentLeadHandoff: protectedProcedure
    .input(dashboardInput)
    .query(({ ctx, input }) =>
      readCurrentLeadHandoffReport(ctx.db, ctx.actor, input, SIG(), ctx.localeFallback),
    ),

  dealWinCohorts: protectedProcedure.input(dealWinCohortsInput).query(async ({ ctx, input }) => {
    const { from, to, pipelineId, ownerScope, currency, horizon } = input;
    const report = await readObservedDealWinCohorts(
      ctx.db,
      ctx.actor,
      { from, to, pipelineId, ownerScope, currency, horizon: dealWinCohortHorizon(horizon) },
      SIG(),
      ctx.localeFallback,
    );
    return dealWinCohortView(report, horizon);
  }),

  currentAttention: protectedProcedure
    .input(analyticsAttentionInput.omit({ limit: true, offset: true }))
    .query(async ({ ctx, input }) => {
      const result = await readAnalyticsAttention(ctx.db, ctx.actor, { ...input, limit: 1 }, SIG());
      if (result.state !== "available") return result;
      return {
        state: "available" as const,
        definition: result.definition,
        timeZone: result.timeZone,
        observedAt: result.observedAt,
        counts: result.counts,
      };
    }),

  currentAccountConcentration: protectedProcedure
    .input(currentAccountConcentrationInput)
    .query(({ ctx, input }) =>
      readCurrentAccountConcentrationReport(
        ctx.db,
        { actor: ctx.actor, session: ctx.session },
        input,
        SIG(),
        ctx.localeFallback,
      ),
    ),

  periodForecast: protectedProcedure
    .input(
      z.strictObject({
        scenario: nativePeriodForecastInput,
        csrfToken: z.string().max(128).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!(await guardCsrf(input.csrfToken)).ok) throw new TRPCError({ code: "FORBIDDEN" });
      return readNativePeriodForecast(
        ctx.db,
        { actor: ctx.actor, session: ctx.session },
        input.scenario,
        SIG(),
        ctx.localeFallback,
      );
    }),

  stageAging: protectedProcedure
    .input(stageAgingInput)
    .query(({ ctx, input }) => readCurrentStageAgingView(ctx.db, ctx.actor, input, SIG())),

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
