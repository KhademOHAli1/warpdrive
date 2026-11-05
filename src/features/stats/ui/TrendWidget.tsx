"use client";
import type React from "react";
import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/Button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import type { WonTrendPoint } from "@/types/stats";
import { useStatsMessages } from "../useStatsMessages";
import { money, monthLabel, Panel } from "./Panel";
import { trendTooltipValue } from "./trendTooltip";

// Value, not count, is the line: "are we going to make the number" is a money question. The
// count travels with it in the tooltip and the table below.
//
// One constant for the series key, because recharts keys the tooltip payload by the mark's
// dataKey and the config is looked up by that same key. Spelling them apart leaves the tooltip
// labelling the series with a variable name, and nothing type-checks the pair.
const SERIES = "value";

// Past two years of monthly samples the dots merge into a band and stop marking anything.
const DOTTED_MONTHS = 24;

export function WonTrendWidget({
  data,
  currency,
  onInspectMonth,
}: {
  data: WonTrendPoint[];
  currency: string;
  onInspectMonth?: (month: string, trigger: HTMLButtonElement) => void;
}): React.ReactNode {
  const preferences = useLocalePreferences();

  const format = useFormatters();

  const S = useStatsMessages();
  const [showData, setShowData] = useState(false);
  const showActions = showData && onInspectMonth !== undefined;
  const tableId = useId();

  const CONFIG: ChartConfig = {
    [SERIES]: { label: S.trendValue, color: "var(--link)" },
  };

  const hasWins = data.some((p) => p.count > 0);
  // The money arrives as a decimal string; recharts plots numbers. count rides along on the row
  // so the tooltip can say how many deals made up the month.
  const points = data.map((p) => ({ month: p.month, count: p.count, [SERIES]: Number(p.value) }));

  return (
    <Panel title={S.widgetWonTrend} isEmpty={!hasWins} emptyText={S.emptyWonTrend}>
      <p className="mb-2 text-xs text-muted-foreground">{S._extra.bucketNotice}</p>
      {hasWins && (
        <>
          {/* The SVG restates the table below it, so it is hidden rather than read twice. */}
          <ChartContainer config={CONFIG} aria-hidden="true" className="h-64 w-full">
            <AreaChart data={points} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={(month: string) => monthLabel(month, preferences, false)}
                tickLine={false}
                axisLine={false}
                minTickGap={16}
              />
              <YAxis
                width={80}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => money(String(v), currency, preferences)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(label) => monthLabel(String(label), preferences)}
                    formatValue={(value, _key, datum) =>
                      trendTooltipValue(value, datum, currency, preferences)
                    }
                  />
                }
              />
              {/* Straight segments and a visible sample per month. A spline through one spike
                  draws a smooth hill, which reads as revenue in the zero months either side. */}
              <Area
                type="linear"
                dataKey={SERIES}
                stroke={`var(--color-${SERIES})`}
                strokeWidth={2}
                fill={`var(--color-${SERIES})`}
                fillOpacity={0.08}
                isAnimationActive={false}
                dot={points.length <= DOTTED_MONTHS && { r: 2.5 }}
              />
            </AreaChart>
          </ChartContainer>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            aria-expanded={showData}
            aria-controls={tableId}
            onClick={() => setShowData(!showData)}
          >
            {showData ? S.hideTrendData : S.showTrendData}
          </Button>
          <div id={tableId} className={cn(showData ? "mt-4 overflow-x-auto" : "sr-only")}>
            <table className="w-full text-start text-sm [&_td]:px-3 [&_td]:py-2 [&_td]:text-end [&_td]:tabular-nums [&_th]:px-3 [&_th]:py-2 [&_th]:text-start [&_tr]:border-b">
              <caption>{S.trendTableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{S.trendMonth}</th>
                  <th scope="col">{S.trendCount}</th>
                  <th scope="col">{S.trendValue}</th>
                  {showActions && <th scope="col">{S.recordsTitle}</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.month}>
                    <th scope="row">{monthLabel(p.month, preferences)}</th>
                    <td>{format.number(p.count)}</td>
                    <td>{money(p.value, currency, preferences)}</td>
                    {showActions && (
                      <td>
                        {p.count > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={S._extra.trendInspectMonth(
                              monthLabel(p.month, preferences),
                            )}
                            onClick={(event) => onInspectMonth?.(p.month, event.currentTarget)}
                          >
                            {S.trendInspect}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
