"use client";

import { ArrowUpRight, ChevronDown, Database, PencilLine } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type { KpiGoalResult } from "@/features/goals/kpiModel";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { KpiTrend } from "./KpiTrend";
import { useKpiPresentation } from "./useKpiPresentation";

export { useKpiPresentation } from "./useKpiPresentation";

function Evidence({ row }: { row: KpiGoalResult }): ReactNode {
  const S = useKpiHubMessages();
  const B = useKpiMessages();
  const format = useFormatters();
  const presentation = useKpiPresentation();
  const { measurement, definition } = row;
  return (
    <div className="space-y-4 border-t bg-muted/10 px-5 py-4">
      <dl className="grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{S.definition}</dt>
          <dd className="mt-1 font-medium">
            {definition.name} · {S.revision} {format.number(definition.revision)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{S.records}</dt>
          <dd className="mt-1 font-medium tabular-nums">
            {format.number(measurement.recordCount)} · {S.excluded}{" "}
            {format.number(measurement.excludedCount)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{S.updated}</dt>
          <dd className="mt-1">{format.dateTime(measurement.evaluatedAt)}</dd>
        </div>
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">{definition.description}</p>
      {measurement.sampleSize !== null && (
        <dl className="flex gap-2 text-xs tabular-nums">
          <dt>{S.sample}</dt>
          <dd>{format.number(measurement.sampleSize)}</dd>
        </dl>
      )}
      {(measurement.missingMeasurementDateCount ?? 0) > 0 && (
        <p className="text-xs tabular-nums text-muted-foreground">
          {S.missingDateCount}: {format.number(measurement.missingMeasurementDateCount ?? 0)}
        </p>
      )}
      <KpiTrend definition={definition} measurement={measurement} />
      {measurement.numerator !== null && (
        <p className="text-xs tabular-nums">
          {S.numerator}: {format.number(measurement.numerator)} · {S.denominator}:{" "}
          {measurement.denominator === null ? "—" : format.number(measurement.denominator)}
        </p>
      )}
      {measurement.issues.length > 0 && (
        <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          {measurement.issues.map((issue) => (
            <li key={issue}>{S.issues[issue] ?? S.incomplete}</li>
          ))}
        </ul>
      )}
      {measurement.contributors.length === 0 ? (
        <p className="text-sm text-muted-foreground">{S.noEvidence}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-start text-sm">
            <caption className="sr-only">
              {S.records}: {definition.name}
            </caption>
            <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {S.record}
                </th>
                <th scope="col" className="px-3 py-2 text-end font-medium">
                  {S.value}
                </th>
                <th scope="col" className="px-3 py-2 text-start font-medium">
                  {S.included}
                </th>
              </tr>
            </thead>
            <tbody>
              {measurement.contributors.map((record) => (
                <tr key={record.id} className="border-b last:border-0">
                  <td className="max-w-80 px-3 py-2">
                    {record.href === null ? (
                      record.label
                    ) : (
                      <Link
                        href={record.href}
                        className="inline-flex items-center gap-1 text-link hover:underline"
                      >
                        {record.label}
                        <ArrowUpRight aria-hidden className="size-3 shrink-0" />
                      </Link>
                    )}
                    {record.observedOn !== undefined && record.observedOn !== null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {format.dateOnly(record.observedOn)}
                      </p>
                    )}
                    {record.statuses !== undefined && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {record.statuses.map((status) => B.statuses[status]).join(" · ")}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                    {record.value === null
                      ? "—"
                      : ["percentage", "ratio"].includes(definition.calculation)
                        ? format.number(record.value)
                        : presentation.value(record.value, definition)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {record.included ? S.included : S.excluded}
                    {record.numeratorMember === true && (
                      <span className="mt-1 block text-xs">{S.numerator}</span>
                    )}
                    {record.denominatorMember === true && (
                      <span className="mt-1 block text-xs">{S.denominator}</span>
                    )}
                    {record.reason !== null && (
                      <span className="mt-1 block text-xs">
                        {S.issues[record.reason] ?? S.excluded}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {measurement.contributorsTruncated && !measurement.issues.includes("record_limit") && (
        <p className="text-xs text-muted-foreground">{S.truncated}</p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">{S.versionNotice}</p>
    </div>
  );
}

export function KpiResults({
  rows,
  names = {},
  onMeasure,
}: {
  rows: KpiGoalResult[];
  names?: Record<string, string>;
  onMeasure?: (row: KpiGoalResult) => void;
}): ReactNode {
  const S = useKpiHubMessages();
  const format = useFormatters();
  const presentation = useKpiPresentation();
  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const { goal, definition, measurement, assessment } = row;
        const reliable = measurement.state === "available" && measurement.value !== null;
        const standing = reliable ? assessment.standing : measurement.state;
        const scopeName =
          goal.scope === "company"
            ? S.company
            : (row.scopeName ?? names[goal.scopeId ?? ""] ?? S[goal.scope]);
        return (
          <article key={goal.id} className="overflow-hidden rounded-xl border bg-card">
            <div className="space-y-4 px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold leading-relaxed">
                    {goal.name !== undefined && goal.name !== "" ? goal.name : definition.name}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {scopeName} · {S.revision} {format.number(definition.revision)}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium",
                    reliable && assessment.standing === "met"
                      ? "border-emerald-600/25 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                      : reliable && assessment.standing === "not_met"
                        ? "border-destructive/25 bg-destructive/5 text-destructive"
                        : "bg-muted/30 text-muted-foreground",
                  )}
                >
                  {S[standing]}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                <div>
                  <p className="text-xs text-muted-foreground">{S.value}</p>
                  <p className="mt-1 break-words text-2xl font-medium tracking-tight tabular-nums">
                    {presentation.value(measurement.value, definition)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{S.target}</p>
                  <p className="mt-1 text-sm font-medium tabular-nums">
                    {presentation.condition(goal.condition, definition)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {measurement.period === null
                      ? S.noPeriod
                      : `${format.dateOnly(measurement.period.start)} – ${format.dateOnly(measurement.period.end)}`}
                  </p>
                </div>
              </div>
              {reliable && assessment.attainment !== null && goal.condition.kind === "at_least" && (
                <meter
                  aria-label={`${definition.name}: ${S.target}`}
                  min={0}
                  max={100}
                  optimum={100}
                  value={Math.max(0, Math.min(100, assessment.attainment * 100))}
                  aria-valuetext={format.number(assessment.attainment, {
                    style: "percent",
                    maximumFractionDigits: 0,
                  })}
                  className={cn(
                    "h-1.5 w-full [&::-webkit-meter-bar]:rounded-full [&::-webkit-meter-bar]:border-0 [&::-webkit-meter-bar]:bg-muted [&::-webkit-meter-bar]:bg-none [&::-webkit-meter-optimum-value]:bg-none [&::-webkit-meter-suboptimum-value]:bg-none [&::-webkit-meter-even-less-good-value]:bg-none",
                    assessment.standing === "met"
                      ? "[&::-webkit-meter-optimum-value]:bg-emerald-600 [&::-webkit-meter-suboptimum-value]:bg-emerald-600 [&::-webkit-meter-even-less-good-value]:bg-emerald-600 [&::-moz-meter-bar]:bg-emerald-600"
                      : "[&::-webkit-meter-optimum-value]:bg-link [&::-webkit-meter-suboptimum-value]:bg-link [&::-webkit-meter-even-less-good-value]:bg-link [&::-moz-meter-bar]:bg-link",
                  )}
                >
                  {format.number(assessment.attainment, {
                    style: "percent",
                    maximumFractionDigits: 0,
                  })}
                </meter>
              )}
              {definition.source === "manual" && onMeasure && (
                <Button variant="outline" size="sm" onClick={() => onMeasure(row)}>
                  <PencilLine aria-hidden className="size-3.5" />
                  {S.recordMeasurement}
                </Button>
              )}
            </div>
            <details className="group">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between border-t px-5 py-2 text-xs font-medium text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2">
                  <Database aria-hidden className="size-3.5" />
                  {S.evidence}
                </span>
                <ChevronDown
                  aria-hidden
                  className="size-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                />
              </summary>
              <Evidence row={row} />
            </details>
          </article>
        );
      })}
    </div>
  );
}
