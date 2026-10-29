"use client";
import type React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { Goal } from "@/db/schema/goals";
import type { GoalPeriod } from "@/features/goals/goalPeriod";
import type { GoalSeriesPoint } from "@/features/goals/goalSeries";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { useStatsMessages } from "../useStatsMessages";
import { goalChartPoints } from "./goalChartPoints";
import { money } from "./Panel";

const ACTUAL = "actual";
const TARGET = "target";

export function GoalChart({
  period,
  series,
  target,
  metric,
  currency,
}: {
  period: GoalPeriod;
  series: GoalSeriesPoint[];
  target: string;
  metric: Goal["metric"];
  currency: string;
}): React.ReactNode {
  const preferences = useLocalePreferences();

  const format = useFormatters();

  const S = useStatsMessages();

  const CONFIG: ChartConfig = {
    [ACTUAL]: { label: S.goalBooked, color: "hsl(var(--primary))" },
    [TARGET]: { label: S.goalTargetPace, color: "hsl(var(--muted-foreground))" },
  };

  const dayLabel = (day: string) => format.dateOnly(day, { month: "short", day: "numeric" });

  const points = goalChartPoints(period, series, target);
  const fmt = (v: number): string =>
    metric === "value" ? money(String(v), currency, preferences) : format.number(Math.round(v));

  return (
    <ChartContainer config={CONFIG} aria-hidden="true" className="h-36">
      <LineChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis width={56} tickLine={false} axisLine={false} tickCount={3} tickFormatter={fmt} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(label) => dayLabel(String(label))}
              formatValue={(value) => (typeof value === "number" ? fmt(value) : null)}
            />
          }
        />
        <Line
          type="linear"
          dataKey={TARGET}
          stroke={`var(--color-${TARGET})`}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
        <Line
          type="linear"
          dataKey={ACTUAL}
          stroke={`var(--color-${ACTUAL})`}
          strokeWidth={2}
          dot={false}
          connectNulls={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
