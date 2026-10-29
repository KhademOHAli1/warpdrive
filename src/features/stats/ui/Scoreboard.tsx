"use client";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import type { ActivityCounters, DealCounters, WonDealStats } from "@/types/stats";
import { useStatsMessages } from "../useStatsMessages";
import { durationDays, money } from "./Panel";

// Pipedrive's scoreboard view: the handful of numbers a manager reads first, above the charts.
// A metric with no data renders a dash, never a zero. "Nobody closed anything" and "everybody
// lost" must not look identical.
function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-medium tabular-nums">{value}</p>
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

  const cycle =
    won.medianCycleDays === null ? S.noValue : durationDays(won.medianCycleDays, preferences);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Tile label={S.scoreWon} value={format.number(deals.won.count)} />
      <Tile
        label={S.scoreWinRate}
        value={winRate === null ? S.noValue : S._extra.percent(Math.round(winRate * 100))}
      />
      <Tile
        label={S.scoreAvgDeal}
        value={won.avgValue === null ? S.noValue : money(won.avgValue, currency, preferences)}
      />
      <Tile label={S.scoreCycle} value={cycle} />
      <Tile label={S.scoreActivities} value={format.number(activities.completed)} />
    </div>
  );
}
