"use client";

import { Download, ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useLocalePreferencePending, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import {
  DEAL_REPORT_EXPORT_LIMIT,
  dealReportExportHref,
} from "@/features/stats/dealReportExportRequest";
import type { DealRecordMetric } from "@/features/stats/metricDictionary";
import { toToken } from "@/features/stats/ownerScopeToken";
import { useStatsMessages } from "@/features/stats/useStatsMessages";
import { type RouterOutputs, trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import type { OwnerScope } from "@/types/stats";
import { monthLabel } from "./Panel";

export interface DealRecordsScope {
  currency: string;
  pipelineId: string | null;
  ownerScope: OwnerScope;
  from: string;
  to: string;
}

export type RecordChartSelection =
  | { kind: "won-month"; month: string; timeZone: string }
  | { kind: "lost-reason"; selector: string; label: string; timeZone: string };

type Cursor = { createdAt: string; id: string };

function chartRecordInput(chart: RecordChartSelection | undefined) {
  switch (chart?.kind) {
    case "won-month":
      return { wonMonth: chart.month };
    case "lost-reason":
      return { lostReason: chart.selector };
    default:
      return {};
  }
}

function chartTitle(
  chart: RecordChartSelection,
  S: ReturnType<typeof useStatsMessages>,
  preferences: ReturnType<typeof useLocalePreferences>,
): string {
  return chart.kind === "won-month"
    ? S._extra.recordsWonMonth(monthLabel(chart.month, preferences))
    : S._extra.recordsLostReason(chart.label);
}

function sameChartScope(
  report: RouterOutputs["stats"]["records"],
  scope: DealRecordsScope,
  chart: RecordChartSelection,
): boolean {
  const matchesSelection =
    chart.kind === "won-month"
      ? report.metric === "won" && report.wonMonth === chart.month
      : report.metric === "lost" && report.lostReason === chart.selector;
  return (
    matchesSelection &&
    report.timeZone === chart.timeZone &&
    report.currency === scope.currency &&
    toToken(report.effectiveOwnerScope) === toToken(scope.ownerScope)
  );
}

function RecordsError({
  scopeChanged,
  retrying,
  onClose,
  onRetry,
}: {
  scopeChanged: boolean;
  retrying: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const S = useStatsMessages();
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <p role="alert" className="text-pretty text-sm text-destructive">
        {scopeChanged ? S.recordsScopeChanged : S.recordsUnavailable}
      </p>
      <Button
        variant="outline"
        className="min-h-10"
        disabled={retrying}
        onClick={scopeChanged ? onClose : onRetry}
      >
        {scopeChanged ? S.recordsClose : S.retry}
      </Button>
    </div>
  );
}

export function DealRecordsDrawer({
  metric,
  scope,
  chart,
  canExport = false,
  onClose,
  onScopeInvalidated,
  returnFocus,
}: {
  metric: DealRecordMetric;
  scope: DealRecordsScope;
  chart?: RecordChartSelection;
  canExport?: boolean;
  onClose: () => void;
  onScopeInvalidated?: () => void;
  returnFocus?: HTMLButtonElement;
}) {
  const S = useStatsMessages();
  const format = useFormatters();
  const preferences = useLocalePreferences();
  const { timeZone } = preferences;
  const preferencePending = useLocalePreferencePending();
  const descriptionId = useId();
  const [cursors, setCursors] = useState<(Cursor | undefined)[]>([undefined]);
  const chartInput = chartRecordInput(chart);
  const query = trpc.stats.records.useQuery(
    {
      ...scope,
      timeZoneIdentity: timeZone,
      metric,
      ...chartInput,
      cursor: cursors[cursors.length - 1],
      limit: 25,
    },
    {
      enabled: !preferencePending,
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
      ...(chart === undefined
        ? {}
        : { refetchOnWindowFocus: "always" as const, refetchOnReconnect: "always" as const }),
    },
  );
  // Each opened drawer must finish a current permission-checked read before cached rows
  // appear. A failed refresh must not leave previously permitted records on screen.
  const candidate =
    !preferencePending &&
    !query.isError &&
    !query.isLoading &&
    !query.isFetching &&
    !query.isPaused &&
    !query.isPlaceholderData &&
    (chart === undefined || query.isFetchedAfterMount)
      ? query.data
      : undefined;
  const scopeChanged =
    chart !== undefined &&
    ((candidate !== undefined && !sameChartScope(candidate, scope, chart)) ||
      (query.isError && query.error.data?.code === "PRECONDITION_FAILED"));
  const result = scopeChanged ? undefined : candidate;
  const exportLink =
    canExport && result !== undefined && result.totals.count <= DEAL_REPORT_EXPORT_LIMIT
      ? dealReportExportHref({
          from: scope.from,
          to: scope.to,
          pipelineId: scope.pipelineId,
          ownerScope: result.effectiveOwnerScope,
          currency: result.currency,
          metric,
          ...chartInput,
          timeZone: result.timeZone,
        })
      : null;
  const titles: Record<DealRecordMetric, string> = {
    added: S.added,
    won: S.trendValue,
    lost: S.lost,
    open: S.open,
    closed: S.scoreWinRate,
    wonValue: S.scoreAvgDeal,
    wonCycle: S.scoreCycle,
  };
  const definitions: Record<DealRecordMetric, string> = {
    added: S.recordsAddedBasis,
    won: S.recordsWonBasis,
    lost: S.recordsLostBasis,
    open: S.recordsOpenBasis,
    closed: S.recordsClosedBasis,
    wonValue: S.recordsWonValueBasis,
    wonCycle: S.recordsWonCycleBasis,
  };
  const statuses = { open: S.open, won: S.won, lost: S.lost };
  const title = chart === undefined ? titles[metric] : chartTitle(chart, S, preferences);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        aria-describedby={descriptionId}
        className="max-w-3xl animate-none transition-none"
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected === true) {
            event.preventDefault();
            returnFocus.focus();
          }
        }}
      >
        <div className="space-y-6 px-5 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6">
          <header className="space-y-2 pe-8">
            <p className="text-xs font-medium text-muted-foreground">{S.recordsTitle}</p>
            <SheetTitle className="text-balance">{title}</SheetTitle>
            <p className="text-pretty text-sm tabular-nums text-muted-foreground">
              {chart !== undefined && <span>{S.recordsReportPeriod} · </span>}
              {format.dateOnly(scope.from)} {S.rangeSeparator} {format.dateOnly(scope.to)} ·{" "}
              <bdi>{scope.currency}</bdi>
            </p>
          </header>
          <p id={descriptionId} className="text-pretty text-sm leading-relaxed">
            {definitions[metric]}
          </p>

          {query.isError || scopeChanged ? (
            <RecordsError
              scopeChanged={scopeChanged}
              retrying={preferencePending || query.isFetching}
              onClose={() => {
                onClose();
                onScopeInvalidated?.();
              }}
              onRetry={() => {
                void query.refetch();
              }}
            />
          ) : result === undefined ? (
            <div role="status" aria-label={S.loading} className="space-y-3">
              <span className="sr-only">{S.loading}</span>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} aria-hidden="true" className="h-12 rounded-md bg-muted" />
              ))}
            </div>
          ) : (
            <section className="space-y-4" aria-label={S.recordsTable}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p role="status" className="text-base font-semibold tabular-nums">
                  {S._extra.recordsCount(result.totals.count)}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  {S._extra.recordsValueCount(result.totals.valueCount, result.totals.count)}
                </p>
              </div>
              {exportLink !== null && (
                <a
                  className={cn(buttonVariants({ variant: "outline" }), "min-h-10")}
                  href={exportLink}
                  download
                  referrerPolicy="no-referrer"
                >
                  <Download aria-hidden="true" className="size-4" />
                  {S.recordsExport}
                </a>
              )}
              {canExport && result.totals.count > DEAL_REPORT_EXPORT_LIMIT && (
                <p className="text-pretty text-sm text-muted-foreground">
                  {S._extra.recordsExportLimit(DEAL_REPORT_EXPORT_LIMIT)}
                </p>
              )}
              {result.rows.length === 0 ? (
                <div className="space-y-4 rounded-lg bg-muted/40 p-5">
                  <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                    {S.recordsEmpty}
                  </p>
                  <Button variant="outline" className="min-h-10" onClick={onClose}>
                    {S.recordsClose}
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-start text-sm">
                    <caption className="sr-only">{S.recordsTable}</caption>
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-start font-medium">
                          {S.recordsDeal}
                        </th>
                        <th scope="col" className="px-4 py-3 text-start font-medium">
                          {S.recordsStatus}
                        </th>
                        <th scope="col" className="px-4 py-3 text-end font-medium">
                          {S.recordsValue}
                        </th>
                        <th scope="col" className="px-4 py-3 text-start font-medium">
                          {S.recordsClosed}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.rows.map((row) => (
                        <tr key={row.id}>
                          <th scope="row" className="min-w-36 px-4 py-3 text-start font-medium">
                            <a
                              href={`/deals/${row.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-10 items-center gap-2 rounded-sm text-link underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="wrap-anywhere">{row.title}</span>
                              <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                              <span className="sr-only">{S.recordsOpenNewTab}</span>
                            </a>
                            <p className="text-xs font-normal tabular-nums text-muted-foreground">
                              {S.recordsCreated}: {format.dateTime(row.createdAt)}
                            </p>
                          </th>
                          <td className="px-4 py-3">{statuses[row.status]}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-end tabular-nums">
                            {row.value === null
                              ? S.noValue
                              : format.currency(row.value, row.currency)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                            {row.closedAt === null ? S.noValue : format.dateTime(row.closedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <nav aria-label={S.recordsTable} className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  className="min-h-10"
                  disabled={cursors.length === 1}
                  onClick={() => setCursors((previous) => previous.slice(0, -1))}
                >
                  {S.recordsPrevious}
                </Button>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {S._extra.recordsPage(cursors.length)}
                </span>
                <Button
                  variant="outline"
                  className="min-h-10"
                  disabled={result.nextCursor === null}
                  onClick={() => {
                    if (result.nextCursor !== null) {
                      const next = result.nextCursor;
                      setCursors((previous) => [...previous, next]);
                    }
                  }}
                >
                  {S.recordsNext}
                </Button>
              </nav>
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                {S.recordsTimeZone}: <bdi>{result.timeZone}</bdi> · {S.recordsUpdated}:{" "}
                <span className="tabular-nums">{format.dateTime(result.generatedAt)}</span>
              </p>
            </section>
          )}
          <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
            {S.recordsLiveNotice}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
