"use client";

import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import type { ActivityCounters, DealCounters, WonDealStats } from "@/types/stats";
import { useStatsMessages } from "../useStatsMessages";
import { durationDays, money } from "./Panel";

function Metric({
  label,
  value,
  detail,
  primary = false,
}: {
  label: string;
  value: string;
  detail: string;
  primary?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        primary &&
          "col-span-2 border-b pb-5 xl:col-span-1 xl:border-b-0 xl:border-e xl:pe-5 xl:pb-0",
      )}
    >
      <dt className="text-pretty text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-3 break-words font-semibold tabular-nums",
          primary ? "text-4xl" : "text-2xl",
        )}
      >
        {value}
      </dd>
      <dd className="mt-2 text-pretty text-xs leading-relaxed text-muted-foreground">{detail}</dd>
    </div>
  );
}

export function Scoreboard({
  deals,
  won,
  activities,
  winRate,
  currency,
}: {
  deals: DealCounters;
  won: WonDealStats;
  activities: ActivityCounters;
  winRate: number | null;
  currency: string;
}) {
  const preferences = useLocalePreferences();
  const format = useFormatters();
  const S = useStatsMessages();
  return (
    <dl
      aria-label={S.widgetScoreboard}
      className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl border bg-card p-5 xl:grid-cols-5"
    >
      <Metric
        primary
        label={S.trendValue}
        value={money(deals.won.value, currency, preferences)}
        detail={`${S.scoreWon}: ${format.number(deals.won.count)}`}
      />
      <Metric
        label={S.scoreWinRate}
        value={winRate === null ? S.noValue : S._extra.percent(Math.round(winRate * 100))}
        detail={S.winRateDefinition}
      />
      <Metric
        label={S.scoreAvgDeal}
        value={won.avgValue === null ? S.noValue : money(won.avgValue, currency, preferences)}
        detail={S.wonBasis}
      />
      <Metric
        label={S.scoreCycle}
        value={
          won.medianCycleDays === null ? S.noValue : durationDays(won.medianCycleDays, preferences)
        }
        detail={S.cycleDefinition}
      />
      <Metric
        label={S.scoreActivities}
        value={format.number(activities.completed)}
        detail={S.activityDefinition}
      />
    </dl>
  );
}
