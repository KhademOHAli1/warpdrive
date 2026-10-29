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
      {rows.map(([label, b]) => (
        <div key={label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-4 py-1">
          <span className="truncate">{label}</span>
          <span className="min-w-8 text-end tabular-nums text-muted-foreground">
            {format.number(b.count)}
          </span>
          <span className="min-w-24 text-end font-medium tabular-nums text-foreground">
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
        <p className="mb-2 text-xs text-muted-foreground">{funnelBasis(ownerScope, S)}</p>
      )}
      <div className="space-y-2">
        {data.map((s) => (
          <div key={s.stageId}>
            <div className="mb-0.5 flex items-center justify-between text-sm">
              <span className="truncate">{s.name}</span>
              <span className="tabular-nums text-muted-foreground">
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
      <p className="tabular-nums">
        {S.completed} {format.number(data.completed)} / {S.scheduled}{" "}
        {format.number(data.scheduled)}
        {data.undated > 0 && (
          <span className="text-muted-foreground">
            {" "}
            ({S.undated} {format.number(data.undated)})
          </span>
        )}
      </p>
    </Panel>
  );
}

export function StageSumsWidget({ data, currency }: { data: StageSum[]; currency: string }) {
  const preferences = useLocalePreferences();

  const S = useStatsMessages();

  const max = Math.max(1, ...data.map((s) => Number(s.total)));
  return (
    <Panel title={S.widgetStageSums} isEmpty={data.length === 0} emptyText={S.emptyStageSums}>
      <div className="space-y-2">
        {data.map((s) => (
          <div key={s.stageId}>
            <div className="mb-0.5 flex items-center justify-between text-sm">
              <span className="truncate">{s.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {money(s.total, currency, preferences)}
              </span>
            </div>
            <Bar label={s.name} pct={(Number(s.total) / max) * 100} />
          </div>
        ))}
      </div>
    </Panel>
  );
}
