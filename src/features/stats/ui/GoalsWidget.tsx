"use client";
import Link from "next/link";
import type React from "react";
import { buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import type { GoalWithProgress } from "@/features/goals/router";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { useStatsMessages } from "../useStatsMessages";
import { GoalChart } from "./GoalChart";
import { money, Panel } from "./Panel";

function paceTone(pace: number | null): string {
  if (pace === null) return "text-muted-foreground";
  return pace >= 1 ? "text-emerald-600" : "text-destructive";
}

function GoalRow({ row }: { row: GoalWithProgress }): React.ReactNode {
  const preferences = useLocalePreferences();

  const format = useFormatters();

  const S = useStatsMessages();

  const { goal, progress, series } = row;
  const goalCopy = useSettingsMessages();
  const K = useKpiHubMessages();
  const isLimit = goal.action === "lost";
  const label =
    goal.subject === "activity"
      ? goalCopy._extra.activityGoalDisplayLabel(
          goal.action,
          goalCopy._extra.goalIntervals[goal.interval],
        )
      : goalCopy._extra.goalDisplayLabel(
          goal.metric === "value" ? goalCopy._extra.goalDealValue : goalCopy._extra.deals,
          goalCopy._extra.goalActions[goal.action],
          goalCopy._extra.goalIntervals[goal.interval],
        );
  const isValue = goal.metric === "value";
  const incomplete = progress?.dataState === "incomplete";
  const fmt = (v: string) =>
    isValue
      ? money(v, goal.currency, preferences)
      : format.number(Number(v), { maximumFractionDigits: 0 });

  if (progress === null) {
    return (
      <div>
        <div className="flex items-center justify-between text-sm">
          <span className="truncate">{label}</span>
          <span className="text-muted-foreground">{S.goalNotStarted}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-sm">
        <span className="truncate">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {fmt(progress.actual)} / {isLimit ? `${K.at_most} ` : ""}
          {fmt(progress.target)}
        </span>
      </div>
      <GoalChart
        period={{ start: progress.periodStart, end: progress.periodEnd }}
        series={series}
        target={progress.target}
        metric={goal.metric}
        currency={goal.currency}
        pacing={isLimit ? "none" : "linear"}
      />
      <p className="mt-0.5 flex justify-between text-xs text-muted-foreground tabular-nums">
        <span>
          {format.dateOnly(progress.periodStart)} {S.rangeSeparator}{" "}
          {format.dateOnly(progress.periodEnd)}
        </span>
        {progress.pace !== null && (
          <span className={paceTone(progress.pace)}>
            {S.goalPace} {S._extra.percent(Math.round(progress.pace * 100))}
          </span>
        )}
        {!incomplete && isLimit && (
          <span
            className={
              Number(progress.actual) <= Number(progress.target)
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-destructive"
            }
          >
            {Number(progress.actual) <= Number(progress.target)
              ? K.thresholdMet
              : K.thresholdExceeded}
          </span>
        )}
      </p>
      {incomplete && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium">{K.incomplete}</span> · {K.missingDateCount}:{" "}
          {format.number(progress.missingMeasurementDateCount ?? 0)}.{" "}
          {K.issues.missing_measurement_dates}
        </p>
      )}
    </div>
  );
}

export function GoalsWidget({
  data,
  canManage,
}: {
  data: GoalWithProgress[];
  currency: string;
  canManage: boolean;
}): React.ReactNode {
  const S = useStatsMessages();

  if (data.length === 0) {
    return (
      <Panel title={S.widgetGoals} isEmpty={false} emptyText="">
        <p className="text-xs leading-relaxed text-muted-foreground">{S.goalsScopeNotice}</p>
        <EmptyState
          title={S.emptyGoals}
          body={S.emptyGoalsBody}
          className="py-8"
          action={
            canManage ? (
              <Link href="/settings/goals" className={buttonVariants({ size: "sm" })}>
                {S.goalsSettingsLink}
              </Link>
            ) : undefined
          }
        />
      </Panel>
    );
  }
  return (
    <Panel title={S.widgetGoals} isEmpty={false} emptyText="">
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{S.goalsScopeNotice}</p>
      <p className="mb-2 text-xs text-muted-foreground">{S._extra.goalPeriodNotice}</p>
      <div className="space-y-3">
        {data.map((row) => (
          <GoalRow key={row.goal.id} row={row} />
        ))}
        {canManage && (
          <Link
            href="/settings/goals"
            className="text-sm text-primary underline-offset-2 hover:underline"
          >
            {S.goalsSettingsLink}
          </Link>
        )}
      </div>
    </Panel>
  );
}
