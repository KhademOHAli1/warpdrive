"use client";

import { ArrowUpRight, ChevronRight, PencilLine } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type { KpiGoalResult } from "@/features/goals/kpiModel";
import { useFormatters } from "@/lib/useFormatters";
import { cn } from "@/lib/utils";
import { KpiTrend } from "./KpiTrend";
import { useKpiPresentation } from "./useKpiPresentation";

export { useKpiPresentation } from "./useKpiPresentation";

export function KpiEvidence({ row }: { row: KpiGoalResult }): ReactNode {
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
                    {record.nodeLabel !== undefined && record.nodeLabel !== "" && (
                      <p className="mb-1 text-xs text-muted-foreground">{record.nodeLabel}</p>
                    )}
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
                      : definition.graph || ["percentage", "ratio"].includes(definition.calculation)
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
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto border-y">
      <table className="w-full text-start text-sm">
        <caption className="sr-only">{S.goals}</caption>
        <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
          <tr>
            {[S.name, S.scope, S.target, S.value, S.status].map((label) => (
              <th key={label} scope="col" className="px-3 py-2 text-start font-medium">
                {label}
              </th>
            ))}
            <th scope="col">
              <span className="sr-only">{S.recordMeasurement}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { goal, definition, measurement, assessment } = row;
            const reliable = measurement.state === "available" && measurement.value !== null;
            const standing = reliable ? assessment.standing : measurement.state;
            const name = goal.name !== undefined && goal.name !== "" ? goal.name : definition.name;
            const scope =
              goal.scope === "company"
                ? S.company
                : (row.scopeName ?? names[goal.scopeId ?? ""] ?? S[goal.scope]);
            return (
              <Fragment key={goal.id}>
                <tr className="border-b last:border-b-0 hover:bg-muted/15">
                  <td className="min-w-48 px-3 py-2.5">
                    <button
                      type="button"
                      className="flex min-h-8 items-center gap-2 text-start font-medium outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${S.evidence}: ${name}`}
                      aria-expanded={expanded === goal.id}
                      onClick={() => setExpanded(expanded === goal.id ? null : goal.id)}
                    >
                      <ChevronRight
                        aria-hidden
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground rtl:rotate-180",
                          expanded === goal.id && "rotate-90 rtl:rotate-90",
                        )}
                      />
                      <span>{name}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{scope}</td>
                  <td className="min-w-44 px-3 py-2.5 tabular-nums">
                    <span>{presentation.condition(goal.condition, definition)}</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {measurement.period === null
                        ? S.noPeriod
                        : `${format.dateOnly(measurement.period.start)} – ${format.dateOnly(measurement.period.end)}`}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium tabular-nums">
                    {presentation.value(measurement.value, definition)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-xs",
                        reliable && assessment.standing === "met"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : reliable && assessment.standing === "not_met"
                            ? "text-destructive"
                            : "text-muted-foreground",
                      )}
                    >
                      <span aria-hidden className="size-1.5 rounded-full bg-current" />
                      {S[standing]}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    {definition.source === "manual" && onMeasure && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`${S.recordMeasurement}: ${name}`}
                        onClick={() => onMeasure(row)}
                      >
                        <PencilLine aria-hidden className="size-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
                {expanded === goal.id && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <KpiEvidence row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
