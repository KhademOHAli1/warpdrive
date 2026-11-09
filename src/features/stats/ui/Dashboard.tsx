"use client";

import {
  CalendarDays,
  ChartLine,
  ChartNoAxesCombined,
  LayoutDashboard,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import type React from "react";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import type { DealRecordMetric } from "@/features/stats/metricDictionary";
import { trpc } from "@/lib/trpc-client";
import { cn } from "@/lib/utils";
import type { OwnerScope } from "@/types/stats";
import { useStatsMessages } from "../useStatsMessages";
import { ActivityTypesWidget, LostReasonsWidget } from "./Breakdowns";
import { CurrentAccountConcentrationPanel } from "./CurrentAccountConcentrationPanel";
import { CurrentAttentionPanel } from "./CurrentAttentionPanel";
import { CurrentLeadHandoffPanel } from "./CurrentLeadHandoffPanel";
import { DashboardError, DashboardLoading } from "./DashboardState";
import { DateRangeControl } from "./DateRangeControl";
import {
  DealRecordsDrawer,
  type DealRecordsScope,
  type RecordChartSelection,
} from "./DealRecordsDrawer";
import { DealWinCohortPanel } from "./DealWinCohortPanel";
import { presetRange } from "./dateRange";
import { GoalsWidget } from "./GoalsWidget";
import { KpiPerformance } from "./KpiPerformance";
import { OwnerScopeSelect } from "./OwnerScopeSelect";
import { Panel } from "./Panel";
import { PeriodForecastPanel } from "./PeriodForecastPanel";
import { RecordedDealSourcePanel } from "./RecordedDealSourcePanel";
import { SavedPerformanceControl } from "./SavedPerformanceControl";
import { Scoreboard } from "./Scoreboard";
import { StageAgingReport } from "./StageAgingReport";
import { WonTrendWidget } from "./TrendWidget";
import { ActivitiesWidget, DealPerformanceWidget, FunnelWidget, StageSumsWidget } from "./widgets";

const ALL_PIPELINES = "all";
const ME_SCOPE: OwnerScope = { kind: "me" };
const subscribeHydration = (): (() => void) => () => {};
const REPORT_TAB = cn(
  PILL_TAB,
  "min-h-10 flex-none px-4 data-[state=active]:bg-link/10 data-[state=active]:text-link",
);

interface DashboardProps {
  canViewOthers: boolean;
  canManageGoals?: boolean;
  canExport?: boolean;
  today: string;
  currency: string;
  defaultPipelineId?: string | null;
}

function DashboardGoals({
  today,
  currency,
  canManage,
}: {
  today: string;
  currency: string;
  canManage: boolean;
}) {
  const S = useStatsMessages();
  const goals = trpc.goals.list.useQuery({ on: today });
  if (goals.isError) {
    return (
      <Panel title={S.widgetGoals} isEmpty={false} emptyText="">
        <p role="alert" className="text-sm text-muted-foreground">
          {S.goalsUnavailable}
        </p>
        <Button
          variant="outline"
          className="mt-4"
          disabled={goals.isFetching}
          onClick={() => {
            void goals.refetch();
          }}
        >
          {S.retry}
        </Button>
      </Panel>
    );
  }
  if (goals.isLoading) {
    return (
      <Panel title={S.widgetGoals} isEmpty={false} emptyText="">
        <p role="status">{S.loading}</p>
      </Panel>
    );
  }
  return <GoalsWidget data={goals.data ?? []} currency={currency} canManage={canManage} />;
}

export function Dashboard({
  canViewOthers,
  canManageGoals = false,
  canExport = false,
  currency,
  today,
}: DashboardProps) {
  const S = useStatsMessages();
  const tCurrency = useAppTranslations("sales");
  const { timeZone, calendar, locale, country, numberingSystem } = useLocalePreferences();
  const preferencePending = useLocalePreferencePending();
  // Quick add can fill the shared pipeline cache before this subtree hydrates.
  // Keep the first picker markup stable, then apply its current query state.
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const [selectedCurrency, setSelectedCurrency] = useState(currency);
  const [ownerScope, setOwnerScope] = useState<OwnerScope>(ME_SCOPE);
  const [range, setRange] = useState(() => presetRange("year", today, calendar));
  const [selectedPipelineId, setSelectedPipelineId] = useState(ALL_PIPELINES);
  const [inspection, setInspection] = useState<{
    metric: DealRecordMetric;
    trigger: HTMLButtonElement;
    chart?: RecordChartSelection & { scope: DealRecordsScope };
  } | null>(null);
  const currentScope = {
    currency: selectedCurrency,
    pipelineId: selectedPipelineId === ALL_PIPELINES ? null : selectedPipelineId,
    ownerScope: canViewOthers ? ownerScope : ME_SCOPE,
  };
  const reportScope = {
    timeZoneIdentity: timeZone,
    ...currentScope,
    ...range,
  };
  const validRange = range.from <= range.to;
  const inspectionScope = inspection?.chart?.scope ?? reportScope;
  const chart = inspection?.chart;
  const chartSelector = chart?.kind === "won-month" ? chart.month : chart?.selector;
  function inspectChart(
    selection: RecordChartSelection,
    trigger: HTMLButtonElement,
    resultScope: { currency: string; effectiveOwnerScope: OwnerScope },
  ) {
    setInspection({
      metric: selection.kind === "won-month" ? "won" : "lost",
      trigger,
      chart: {
        ...selection,
        scope: {
          from: reportScope.from,
          to: reportScope.to,
          pipelineId: reportScope.pipelineId,
          currency: resultScope.currency,
          ownerScope: resultScope.effectiveOwnerScope,
        },
      },
    });
  }
  const pipelinesQ = trpc.pipeline.list.useQuery();
  const pipelineOptions = [
    { value: ALL_PIPELINES, label: S.allPipelines },
    ...(hydrated ? (pipelinesQ.data ?? []) : []).map((p) => ({ value: p.id, label: p.name })),
  ];
  const ownerOptionsQ = trpc.stats.ownerOptions.useQuery(undefined, { enabled: canViewOthers });
  const data = trpc.stats.dashboard.useQuery(reportScope, {
    enabled: validRange && !preferencePending,
  });
  const result =
    validRange && !preferencePending && !data.isLoading && !data.isError ? data.data : undefined;
  let body: React.ReactNode;
  if (!validRange) {
    body = (
      <p
        role="alert"
        className="rounded-xl border border-destructive/30 bg-card p-5 text-sm text-destructive"
      >
        {S.invalidRange}
      </p>
    );
  } else if (data.isError) {
    body = (
      <DashboardError
        onRetry={() => {
          void data.refetch();
        }}
        retrying={preferencePending || data.isFetching}
      />
    );
  } else if (result === undefined) {
    body = <DashboardLoading />;
  } else {
    body = (
      <div className="space-y-5">
        <Scoreboard
          deals={result.dealPerformance}
          won={result.wonDealStats}
          activities={result.activities}
          winRate={result.winRate}
          currency={result.currency}
          onInspect={(metric, trigger) => setInspection({ metric, trigger })}
        />
        <TabsContent value="overview" className="space-y-5">
          <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <WonTrendWidget
              data={result.wonTrend}
              currency={result.currency}
              onInspectMonth={(month, trigger) =>
                inspectChart(
                  { kind: "won-month", month, timeZone: result.timeZone },
                  trigger,
                  result,
                )
              }
            />
            <DashboardGoals today={today} currency={result.currency} canManage={canManageGoals} />
          </div>
          <KpiPerformance today={today} canManage={canManageGoals} />
          <div className="grid gap-5 lg:grid-cols-2">
            <DealPerformanceWidget data={result.dealPerformance} currency={result.currency} />
            <FunnelWidget data={result.funnel} ownerScope={result.effectiveOwnerScope} />
          </div>
        </TabsContent>
        <TabsContent value="activities" className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <ActivitiesWidget data={result.activities} />
            <ActivityTypesWidget data={result.activitiesByType} />
          </div>
        </TabsContent>
        <TabsContent value="acquisition" className="space-y-5">
          <RecordedDealSourcePanel
            key={`source-${JSON.stringify(reportScope)}`}
            scope={reportScope}
          />
          <CurrentLeadHandoffPanel
            key={`handoff-${JSON.stringify(reportScope)}`}
            scope={reportScope}
          />
        </TabsContent>
      </div>
    );
  }
  return (
    <div className="min-h-full bg-muted/20 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex items-start gap-4">
          <div>
            <h1 className="text-balance text-display font-[450] leading-tight tracking-tight">
              {S.title}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
              {S.subtitle}
            </p>
          </div>
        </header>
        <section
          aria-label={S.filtersLabel}
          className="space-y-4 rounded-xl border bg-card p-4 sm:p-5 [&_button]:min-h-10"
        >
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            <div className="col-span-2 min-w-0 space-y-2 xl:col-span-1">
              <p className="text-xs font-medium text-muted-foreground">{S.pipelineLabel}</p>
              <Select
                ariaLabel={S.pipelineLabel}
                value={selectedPipelineId}
                onChange={setSelectedPipelineId}
                options={pipelineOptions}
                disabled={!hydrated || pipelinesQ.isLoading || pipelinesQ.isError}
              />
            </div>
            <div className="min-w-0 space-y-2 [&_button]:w-full">
              <p className="text-xs font-medium text-muted-foreground">{S.ownerScopeLabel}</p>
              <OwnerScopeSelect
                value={result?.effectiveOwnerScope ?? currentScope.ownerScope}
                onChange={setOwnerScope}
                canViewOthers={canViewOthers}
                users={ownerOptionsQ.data?.users ?? []}
                teams={ownerOptionsQ.data?.teams ?? []}
              />
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{S.currencyLabel}</p>
              <CurrencySelect value={selectedCurrency} onChange={setSelectedCurrency} />
            </div>
          </div>
          <DateRangeControl today={today} from={range.from} to={range.to} onChange={setRange} />
          <SavedPerformanceControl
            scope={{ ...currentScope, ...range }}
            canSave={validRange && !preferencePending}
            pipelineOptions={pipelineOptions}
            ownerUsers={ownerOptionsQ.data?.users ?? []}
            ownerTeams={ownerOptionsQ.data?.teams ?? []}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {tCurrency("currencyNotice")}
          </p>
          {result !== undefined && result.timeZone !== "" && (
            <p className="text-xs text-muted-foreground">
              {S.recordsTimeZone}: <bdi>{result.timeZone}</bdi>
            </p>
          )}
          {pipelinesQ.isError && (
            <p role="alert" className="text-sm text-destructive">
              {S.pipelinesUnavailable}{" "}
              <Button
                variant="ghost"
                size="sm"
                disabled={pipelinesQ.isFetching}
                onClick={() => {
                  void pipelinesQ.refetch();
                }}
              >
                {S.retry}
              </Button>
            </p>
          )}
          {canViewOthers && ownerOptionsQ.isError && (
            <p role="alert" className="text-sm text-destructive">
              {S.ownersUnavailable}{" "}
              <Button
                variant="ghost"
                size="sm"
                disabled={ownerOptionsQ.isFetching}
                onClick={() => {
                  void ownerOptionsQ.refetch();
                }}
              >
                {S.retry}
              </Button>
            </p>
          )}
        </section>
        <Tabs defaultValue="overview">
          <TabsList
            aria-label={S.viewsLabel}
            className="mb-5 min-h-12 flex-wrap gap-1 border-b pb-3 group-data-horizontal/tabs:h-auto"
          >
            <TabsTrigger value="overview" className={REPORT_TAB}>
              <LayoutDashboard aria-hidden="true" className="me-2 hidden size-4 sm:block" />
              {S.overviewTab}
            </TabsTrigger>
            <TabsTrigger value="pipeline" className={REPORT_TAB}>
              <SlidersHorizontal aria-hidden="true" className="me-2 hidden size-4 sm:block" />
              {S.pipelineTab}
            </TabsTrigger>
            <TabsTrigger value="activities" className={REPORT_TAB}>
              <CalendarDays aria-hidden="true" className="me-2 hidden size-4 sm:block" />
              {S.activitiesTab}
            </TabsTrigger>
            <TabsTrigger value="acquisition" className={REPORT_TAB}>
              <ChartNoAxesCombined aria-hidden="true" className="me-2 hidden size-4 sm:block" />
              {S.recordedSource.tab}
            </TabsTrigger>
            <TabsTrigger value="accounts" className={REPORT_TAB}>
              <UsersRound aria-hidden="true" className="me-2 hidden size-4 sm:block" />
              {S.currentAccount.tab}
            </TabsTrigger>
            <TabsTrigger value="forecast" className={REPORT_TAB}>
              <ChartLine aria-hidden="true" className="me-2 hidden size-4 sm:block" />
              {S.forecast.tab}
            </TabsTrigger>
          </TabsList>
          {body}
          <TabsContent value="pipeline" className="mt-5 space-y-5">
            {result !== undefined && (
              <>
                <div className="grid gap-5 lg:grid-cols-2">
                  <DealPerformanceWidget data={result.dealPerformance} currency={result.currency} />
                  <FunnelWidget data={result.funnel} ownerScope={result.effectiveOwnerScope} />
                  <StageSumsWidget data={result.stageSums} currency={result.currency} />
                  <LostReasonsWidget
                    data={result.lostReasons}
                    currency={result.currency}
                    onInspectReason={(selector, label, trigger) =>
                      inspectChart(
                        { kind: "lost-reason", selector, label, timeZone: result.timeZone },
                        trigger,
                        result,
                      )
                    }
                  />
                </div>
                <DealWinCohortPanel scope={reportScope} />
              </>
            )}
            <StageAgingReport key={`aging-${JSON.stringify(currentScope)}`} scope={currentScope} />
            <CurrentAttentionPanel
              key={`attention-${JSON.stringify(currentScope)}`}
              scope={currentScope}
            />
          </TabsContent>
          <TabsContent value="accounts" className="mt-5">
            {validRange && (
              <CurrentAccountConcentrationPanel
                key={JSON.stringify(reportScope)}
                scope={reportScope}
              />
            )}
          </TabsContent>
          <TabsContent value="forecast" className="mt-5">
            <PeriodForecastPanel
              key={JSON.stringify({
                currentScope,
                today,
                timeZone,
                calendar,
                locale,
                country,
                numberingSystem,
              })}
              scope={currentScope}
              today={today}
            />
          </TabsContent>
        </Tabs>
      </div>
      {inspection !== null && validRange && (
        <DealRecordsDrawer
          key={JSON.stringify({
            ...inspectionScope,
            timeZoneIdentity: timeZone,
            metric: inspection.metric,
            chartSelector,
          })}
          scope={inspectionScope}
          metric={inspection.metric}
          chart={chart}
          canExport={canExport}
          returnFocus={inspection.trigger}
          onScopeInvalidated={() => {
            void data.refetch();
          }}
          onClose={() => setInspection(null)}
        />
      )}
    </div>
  );
}
