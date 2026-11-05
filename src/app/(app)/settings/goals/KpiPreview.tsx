"use client";

import { CircleAlert, Database, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type { KpiDefinitionInput, KpiMeasurement } from "@/features/goals/kpiModel";
import { useFormatters } from "@/lib/useFormatters";

export function KpiPreview({
  definition,
  measurement,
  loading,
  error,
  changed,
}: {
  definition: KpiDefinitionInput;
  measurement: KpiMeasurement | null;
  loading: boolean;
  error: string | null;
  changed: boolean;
}): React.ReactElement {
  const L = useKpiMessages();
  const H = useKpiHubMessages();
  const exclusionReasons: Record<string, string> = { ...L.exclusionReasons, ...H.issues };
  const format = useFormatters();
  if (loading)
    return (
      <div
        role="status"
        className="flex min-h-52 items-center justify-center gap-3 rounded-lg border bg-muted/10 p-5 text-sm text-muted-foreground"
      >
        <LoaderCircle
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        {L.previewLoading}
      </div>
    );
  if (error !== null)
    return (
      <p
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-destructive/20 p-4 text-sm text-destructive"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  if (!measurement)
    return (
      <div
        role="status"
        className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/10 px-6 py-8 text-center"
      >
        <Database className="mb-3 size-5 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          {changed ? L.previewChanged : L.previewEmpty}
        </p>
      </div>
    );
  const display = (value: string): string =>
    definition.unit === "money"
      ? format.currency(value, definition.currency)
      : `${format.number(value, { maximumFractionDigits: 4 })}${definition.unit === "percent" ? "%" : definition.unit === "count" ? "" : ` ${definition.unit === "custom" ? (definition.customUnit ?? "") : L.units[definition.unit]}`}`;
  const notes = measurement.issues.filter((issue) => issue !== "viewer_visible_records");
  const noteMessages: Record<string, string> = {
    zero_denominator: L.emptyDenominator,
    no_manual_measurements: L.manualPreview,
    outside_goal_period: L.outsidePeriod,
    measurement_older_than_seven_days: L.stale,
    missing_values: L.incomplete,
    record_limit: L.contributorHelp,
    manual_observations: L.manualNotice,
  };
  const included = measurement.contributors.filter((record) => record.included);
  const excluded = measurement.contributors.filter((record) => !record.included);
  const displayRecord = (value: string): string =>
    definition.graph ||
    definition.calculation === "percentage" ||
    definition.calculation === "ratio"
      ? format.number(value, { maximumFractionDigits: 4 })
      : display(value);
  return (
    <div className="space-y-5">
      <div className="rounded-xl border bg-muted/10 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-muted-foreground">{L.currentValue}</p>
          <span className="rounded-full border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
            {L[measurement.state]}
          </span>
        </div>
        <p
          className="mt-3 break-words text-3xl font-[450] tracking-tight tabular-nums"
          aria-live="polite"
        >
          {measurement.value === null ? "—" : display(measurement.value)}
        </p>
        {measurement.period && (
          <p className="mt-2 text-xs text-muted-foreground">
            {format.dateOnly(measurement.period.start)} – {format.dateOnly(measurement.period.end)}
          </p>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 text-xs">
          <div>
            <dt className="text-muted-foreground">{L.recordCount}</dt>
            <dd className="mt-1.5 text-sm font-medium tabular-nums">
              {format.number(measurement.recordCount)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{L.excludedCount}</dt>
            <dd className="mt-1.5 text-sm font-medium tabular-nums">
              {format.number(measurement.excludedCount)}
            </dd>
          </div>
        </dl>
        {measurement.numerator !== null && measurement.denominator !== null && (
          <p className="mt-4 border-t pt-3 text-xs tabular-nums text-muted-foreground">
            {L.numerator}: {format.number(measurement.numerator)} / {L.denominator}:{" "}
            {format.number(measurement.denominator)}
          </p>
        )}
        {measurement.sampleSize !== null && (
          <p className="mt-3 text-xs text-muted-foreground">
            {L.sampleSize}: {format.number(measurement.sampleSize)}
          </p>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          {L.evaluatedAt}: {format.dateTime(measurement.evaluatedAt)}
        </p>
      </div>
      {notes.length > 0 && (
        <div className="rounded-lg border bg-muted/15 p-4">
          <p className="text-xs font-medium">{L.sourceNotes}</p>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
            {notes.map((note) => (
              <li key={note}>{noteMessages[note] ?? H.issues[note] ?? L.incomplete}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="text-sm font-medium">{L.contributors}</h4>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{L.contributorHelp}</p>
        <div className="mt-3 max-h-64 divide-y overflow-y-auto overscroll-contain rounded-lg border">
          {included.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">{L.noContributors}</p>
          ) : (
            included.map((record) => (
              <div
                key={record.id}
                className="flex min-w-0 items-start justify-between gap-4 p-3 text-xs"
              >
                {record.nodeLabel !== undefined && record.nodeLabel !== "" && (
                  <span className="text-muted-foreground">{record.nodeLabel}</span>
                )}
                {record.href?.startsWith("/") === true && !record.href.startsWith("//") ? (
                  <Link
                    className="min-w-0 break-words font-medium underline-offset-4 hover:underline"
                    href={record.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {record.label}
                  </Link>
                ) : (
                  <span className="min-w-0 break-words font-medium">{record.label}</span>
                )}
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {record.value === null ? "—" : displayRecord(record.value)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
      {excluded.length > 0 && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-xs font-medium">
            {L.excludedCount} · {format.number(measurement.excludedCount)}
          </summary>
          <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto overscroll-contain">
            {excluded.map((record) => (
              <li key={record.id} className="text-xs">
                <p className="break-words font-medium">{record.label}</p>
                <p className="mt-1 leading-relaxed text-muted-foreground">
                  {exclusionReasons[record.reason ?? ""] ?? L.excludedCount}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
