"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { formatDateOnly, formatDateTime } from "@/lib/localeFormatting";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { OwnerScope } from "@/types/stats";
import {
  DEAL_WIN_COHORT_HORIZON_DAYS,
  DEAL_WIN_COHORT_HORIZONS,
  type DealWinCohortHorizon,
  type DealWinCohortView,
} from "../history/dealWinCohortView";
import { useStatsMessages } from "../useStatsMessages";
import { Panel } from "./Panel";

type Report = Extract<DealWinCohortView, { state: "available" }>;
type Row = Report["rows"][number];
interface Scope {
  pipelineId: string | null;
  ownerScope: OwnerScope;
  currency: string;
  from: string;
  to: string;
}

function CohortRate({ row }: { row: Row }) {
  const { cohort } = useStatsMessages();
  const format = useFormatters();
  if (row.rate.state === "available") {
    return format.number(row.rate.wins / row.rate.mature, {
      style: "percent",
      maximumFractionDigits: 1,
    });
  }
  return row.rate.reason === "no-mature-deals" ? cohort.notMature : cohort.unknownRate;
}

function CohortRows({ report }: { report: Report }) {
  const { cohort } = useStatsMessages();
  const format = useFormatters();
  const datePreferences = { ...useLocalePreferences(), calendar: report.calendar };
  const columns = [
    cohort.month,
    cohort.entries,
    cohort.mature,
    cohort.immature,
    cohort.wins,
    cohort.unknown,
    cohort.rate,
  ];
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-full text-start text-sm">
        <caption className="sr-only">{cohort.title}</caption>
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            {columns.map((label, i) => (
              <th
                key={label}
                scope="col"
                className={
                  i === 0
                    ? "min-w-32 px-4 py-3 text-start font-medium"
                    : "px-4 py-3 text-end font-medium"
                }
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {report.rows.map((row) => (
            <tr key={row.calendarMonthStart}>
              <th scope="row" className="px-4 py-3 text-start font-medium">
                {formatDateOnly(row.calendarMonthStart, datePreferences, {
                  year: "numeric",
                  month: "short",
                })}
              </th>
              <td className="px-4 py-3 text-end tabular-nums">{format.number(row.entered)}</td>
              <td className="px-4 py-3 text-end tabular-nums">{format.number(row.mature)}</td>
              <td className="px-4 py-3 text-end tabular-nums">{format.number(row.immature)}</td>
              <td className="px-4 py-3 text-end tabular-nums">
                {format.number(row.confirmedWins)}
              </td>
              <td className="px-4 py-3 text-end tabular-nums">
                {format.number(row.unknownOutcomes)}
              </td>
              <td className="px-4 py-3 text-end tabular-nums">
                <CohortRate row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CohortEvidence({ report }: { report: Report }) {
  const S = useStatsMessages();
  const t = useAppTranslations("preferences");
  const datePreferences = {
    ...useLocalePreferences(),
    calendar: report.calendar,
    timeZone: report.timeZone,
  };
  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted-foreground">
        <span>{t(report.calendar === "persian" ? "persianCalendar" : "gregorianCalendar")}</span>
        <span aria-hidden="true">·</span>
        <bdi>{report.timeZone}</bdi>
      </p>
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{S.cohort.observedThrough}</dt>
          <dd>
            <time dateTime={report.observationCutoff}>
              {formatDateTime(report.observationCutoff, datePreferences)}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{S.cohort.coveredFrom}</dt>
          <dd>
            <time dateTime={report.covered.fromInclusive}>
              {formatDateTime(report.covered.fromInclusive, datePreferences)}
            </time>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {report.covered.upperBound === "inclusive"
              ? S.cohort.coveredThrough
              : S.cohort.coveredBefore}
          </dt>
          <dd>
            <time dateTime={report.covered.to}>
              {formatDateTime(report.covered.to, datePreferences)}
            </time>
          </dd>
        </div>
      </dl>
      {report.covered.state === "partial" && (
        <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
          {S.cohort.partial}
        </p>
      )}
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{S.cohort.empty}</p>
      ) : (
        <CohortRows report={report} />
      )}
    </div>
  );
}

function CohortContent({
  report,
}: {
  report: Exclude<DealWinCohortView, { state: "unavailable" }>;
}) {
  const { cohort } = useStatsMessages();
  switch (report.state) {
    case "available":
      return <CohortEvidence report={report} />;
    case "coverage-not-started":
      return <p className="text-sm text-muted-foreground">{cohort.noCapture}</p>;
    case "period-not-covered":
      return <p className="text-sm text-muted-foreground">{cohort.noPeriod}</p>;
  }
}

export function DealWinCohortPanel({ scope }: { scope: Scope }) {
  const S = useStatsMessages();
  const { calendar, timeZone } = useLocalePreferences();
  const pending = useLocalePreferencePending();
  const [horizon, setHorizon] = useState<DealWinCohortHorizon>("30-days");
  const query = trpc.stats.dealWinCohorts.useQuery(
    { ...scope, calendarIdentity: calendar, timeZoneIdentity: timeZone, horizon },
    { enabled: !pending, staleTime: 0, gcTime: 0, refetchOnMount: "always" },
  );
  const report = query.data;
  const ownOnly =
    report?.state === "available" &&
    report.effectiveOwnerScope === "me" &&
    scope.ownerScope.kind !== "me";
  return (
    <Panel title={S.cohort.title} isEmpty={false} emptyText="">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-prose text-pretty text-sm text-muted-foreground">
            {S.cohort.definition}
          </p>
          <div className="min-w-40">
            <Select
              ariaLabel={S.cohort.horizon}
              value={horizon}
              options={DEAL_WIN_COHORT_HORIZONS.map((value) => ({
                value,
                label: S._extra.cohortHorizonDays(DEAL_WIN_COHORT_HORIZON_DAYS[value]),
              }))}
              onChange={(value) => {
                const supported = DEAL_WIN_COHORT_HORIZONS.find((option) => option === value);
                if (supported !== undefined) setHorizon(supported);
              }}
              disabled={pending}
            />
          </div>
        </div>
        {pending || query.isLoading || query.isFetching ? (
          <p role="status" className="text-sm text-muted-foreground">
            {S.loading}
          </p>
        ) : query.isError || report?.state === "unavailable" ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-muted-foreground">
              {S.cohort.unavailable}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch();
              }}
            >
              {S.retry}
            </Button>
          </div>
        ) : report !== undefined ? (
          <>
            {ownOnly && <p className="text-sm text-muted-foreground">{S.cohort.ownDealsOnly}</p>}
            <CohortContent report={report} />
          </>
        ) : null}
      </div>
    </Panel>
  );
}
