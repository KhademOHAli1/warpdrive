"use client";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type {
  ActivityCounters,
  DealCounters,
  OwnerScope,
  StageConversionRow,
  StageSum,
} from "@/types/stats";
import type { StatsMessages } from "../statsMessages";
import { useStatsMessages } from "../useStatsMessages";
import { Bar, durationDays, money, Panel } from "./Panel";

export function DealPerformanceWidget({
  data,
  currency,
}: {
  data: DealCounters;
  currency: string;
}) {
  const preferences = useLocalePreferences();

  const format = useFormatters();

  const S = useStatsMessages();

  // Added/won/lost are windowed by their own date column; "Open now" is a snapshot, so it is
  // labelled differently to stop it reading as a fourth measure of the same period.
  const rows: [string, { count: number; value: string }][] = [
    [S.added, data.added],
    [S.won, data.won],
    [S.lost, data.lost],
    [S.open, data.open],
  ];
  return (
    <Panel title={S.widgetDealPerformance} isEmpty={false} emptyText="">
      {/* Both numeric columns are their own grid track, so counts and money each line up on a
          single right edge instead of floating wherever justify-between put them. */}
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{S.pipelineExplanation}</p>
      {rows.map(([label, b]) => (
        <div
          key={label}
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b py-3 text-sm last:border-0 sm:gap-4"
        >
          <span className="truncate">{label}</span>
          <span className="min-w-8 text-end tabular-nums text-muted-foreground">
            {format.number(b.count)}
          </span>
          <span className="break-all text-end font-medium tabular-nums text-foreground">
            {money(b.value, currency, preferences)}
          </span>
        </div>
      ))}
    </Panel>
  );
}

function funnelBasis(scope: OwnerScope, S: StatsMessages): string {
  switch (scope.kind) {
    case "me":
      return S.funnelBasisMe;
    case "all":
      return S.funnelBasisAll;
    case "user":
      return S.funnelBasisUser;
    case "team":
      return S.funnelBasisTeam;
  }
}

export function FunnelWidget({
  data,
  ownerScope,
}: {
  data: StageConversionRow[];
  ownerScope: OwnerScope;
}) {
  const preferences = useLocalePreferences();

  const format = useFormatters();

  const S = useStatsMessages();

  return (
    <Panel title={S.widgetFunnelConversion} isEmpty={data.length === 0} emptyText={S.emptyFunnel}>
      {data.length > 0 && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{funnelBasis(ownerScope, S)}</p>
          <p className="mb-4 text-pretty text-xs leading-relaxed text-muted-foreground">
            {S.funnelLegacyNotice}
          </p>
        </>
      )}
      <div className="space-y-5">
        {data.map((s) => (
          <div key={s.stageId}>
            <div className="mb-2 flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{s.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {format.number(s.reached)} · {S._extra.percent(Math.round(s.conversion * 100))}
              </span>
            </div>
            <Bar label={s.name} pct={s.conversion * 100} />
            {s.medianDaysInStage !== null && (
              <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {durationDays(s.medianDaysInStage, preferences)}
              </p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ActivitiesWidget({ data }: { data: ActivityCounters }) {
  const format = useFormatters();

  const S = useStatsMessages();

  return (
    <Panel title={S.widgetActivities} isEmpty={false} emptyText="">
      <p className="mb-5 text-xs leading-relaxed text-muted-foreground">{S.activityExplanation}</p>
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          [S.completed, data.completed],
          [S.scheduled, data.scheduled],
          [S.activityAdded, data.added],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-muted/40 p-4">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">
              {format.number(Number(value))}
            </dd>
          </div>
        ))}
      </dl>
      {data.undated > 0 && (
        <p className="mt-4 rounded-lg border px-3 py-2 text-sm text-muted-foreground">
          {S.undated} {format.number(data.undated)}
        </p>
      )}
    </Panel>
  );
}

export function StageSumsWidget({ data, currency }: { data: StageSum[]; currency: string }) {
  const preferences = useLocalePreferences();

  const S = useStatsMessages();

  const max = Math.max(1, ...data.map((s) => Number(s.total)));
  return (
    <Panel title={S.widgetStageSums} isEmpty={data.length === 0} emptyText={S.emptyStageSums}>
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{S.snapshotNotice}</p>
      <div className="space-y-5">
        {data.map((s) => (
          <div key={s.stageId}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0 break-words">{s.name}</span>
              <span className="tabular-nums">{money(s.total, currency, preferences)}</span>
            </div>
            <Bar label={s.name} pct={(Number(s.total) / max) * 100} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
