"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import type { KpiDefinition, KpiMeasurement } from "@/features/goals/kpiModel";
import { useFormatters } from "@/lib/useFormatters";
import { useKpiPresentation } from "./useKpiPresentation";

export function KpiTrend({
  definition,
  measurement,
}: {
  definition: KpiDefinition;
  measurement: KpiMeasurement;
}) {
  const S = useKpiHubMessages();
  const format = useFormatters();
  const presentation = useKpiPresentation();
  const points = measurement.trend ?? [];
  if (points.length === 0) return null;
  const series = points.map((p) => ({ ...p, amount: p.value === null ? null : Number(p.value) }));
  const day = (value: string) => format.dateOnly(value, { month: "short", day: "numeric" });
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-xs font-medium">{S.trend}</h4>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {S.trendNote}
        </p>
      </div>
      {points.length > 1 && (
        <ChartContainer
          aria-hidden="true"
          className="h-40 w-full"
          config={{ amount: { label: S.value, color: "var(--link)" } }}
        >
          <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={day}
              axisLine={false}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis
              width={72}
              tickCount={3}
              tickFormatter={(v) =>
                format.number(Number(v), { notation: "compact", maximumFractionDigits: 1 })
              }
              axisLine={false}
              tickLine={false}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(v) => day(String(v))}
                  formatValue={(v) =>
                    typeof v === "number" ? presentation.value(String(v), definition) : null
                  }
                />
              }
            />
            <Line
              type="linear"
              dataKey="amount"
              stroke="var(--color-amount)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      )}
      <details>
        <summary className="cursor-pointer text-xs font-medium text-link outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {S.trend}
        </summary>
        <div className="mt-3 max-h-56 overflow-auto rounded-lg border">
          <table className="w-full text-start text-xs">
            <caption className="sr-only">
              {definition.name}: {S.trend}
            </caption>
            <thead className="border-b bg-muted/20">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {S.asOf}
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  {S.value}
                </th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.day} className="border-b last:border-0">
                  <td className="px-3 py-2">{format.dateOnly(point.day)}</td>
                  <td className="px-3 py-2 text-end tabular-nums">
                    {presentation.value(point.value, definition)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
