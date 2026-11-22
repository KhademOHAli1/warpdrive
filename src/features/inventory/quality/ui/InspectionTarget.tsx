"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { AttachmentIcon } from "@/features/files/AttachmentIcon";
import { useFormatters } from "@/lib/useFormatters";
import { useHydrated } from "@/lib/useHydrated";
import type {
  QualityResultLine,
  QualityRun,
  QualityStepDraft,
  QualityTargetDetail,
  QualityTargetStatus,
} from "../contracts";
import { type ExecuteInspectionCommand, InspectionForm } from "./InspectionForm";
import type { InspectionMessages } from "./inspectionMessages";

export function QualityStatus({
  status,
  t,
}: {
  status: QualityTargetStatus;
  t: InspectionMessages;
}) {
  const variant = { pending: "secondary", failed: "destructive", passed: "success" } as const;
  return <Badge variant={variant[status]}>{t[status]}</Badge>;
}

function evidenceHref(targetId: string, runId: string, evidenceId: string) {
  const search = new URLSearchParams({ targetId, runId, evidenceId });
  return `/inventory/quality/evidence?${search.toString()}`;
}

function useInspectionNumber() {
  const { number } = useFormatters();
  const hydrated = useHydrated();
  return (value: number) =>
    hydrated ? number(value, { maximumSignificantDigits: 17 }) : String(value);
}

function InspectionFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function PlanSteps({ steps, t }: { steps: QualityStepDraft[]; t: InspectionMessages }) {
  const number = useInspectionNumber();
  return (
    <ul className="space-y-2 border-t pt-3">
      {steps.map((step) => (
        <li key={step.key} className="space-y-1 text-sm [overflow-wrap:anywhere]">
          <p className="font-medium">
            <bdi>{step.label}</bdi>
          </p>
          {step.kind === "measurement" && (
            <dl className="flex flex-wrap gap-x-4">
              {step.minimum !== null && (
                <InspectionFact label={t.minimum}>
                  <bdi>
                    {number(step.minimum)} {step.unit}
                  </bdi>
                </InspectionFact>
              )}
              {step.maximum !== null && (
                <InspectionFact label={t.maximum}>
                  <bdi>
                    {number(step.maximum)} {step.unit}
                  </bdi>
                </InspectionFact>
              )}
            </dl>
          )}
          {step.evidenceRequired && (
            <p className="text-xs text-muted-foreground">{t.requiredEvidence}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function InspectionLine({
  result,
  step,
  targetId,
  runId,
  t,
}: {
  result: QualityResultLine;
  step: QualityStepDraft | undefined;
  targetId: string;
  runId: string;
  t: InspectionMessages;
}) {
  const number = useInspectionNumber();
  const actual =
    typeof result.actual === "boolean"
      ? result.actual
        ? t.passCheck
        : t.failCheck
      : [number(result.actual), step?.kind === "measurement" ? step.unit : ""]
          .filter(Boolean)
          .join(" ");
  return (
    <li className="space-y-1 text-sm" data-quality-result-key={result.key}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <bdi>{step?.label ?? result.key}</bdi>
        </span>
        <div className="flex items-center gap-2">
          <bdi className="text-muted-foreground tabular-nums">{actual}</bdi>
          <QualityStatus status={result.passed ? "passed" : "failed"} t={t} />
        </div>
      </div>
      {result.evidence.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {result.evidence.map((file) => (
            <li key={file.id} className="min-w-0">
              <a
                className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                href={evidenceHref(targetId, runId, file.id)}
                download={file.name}
                data-quality-evidence-id={file.id}
              >
                <AttachmentIcon filename={file.name} size={18} />
                <bdi className="[overflow-wrap:anywhere]">{file.name}</bdi>
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function InspectionRun({
  run,
  target,
  t,
}: {
  run: QualityRun;
  target: QualityTargetDetail;
  t: InspectionMessages;
}) {
  const { dateTime } = useFormatters();
  const hydrated = useHydrated();
  const steps = new Map(target.plan.steps.map((step) => [step.key, step]));
  return (
    <li
      className="space-y-3 rounded-md border p-3"
      data-quality-run-id={run.id}
      data-quality-run-status={run.passed ? "passed" : "failed"}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold [overflow-wrap:anywhere]">
            <bdi>{run.station}</bdi>
          </p>
          <div className="flex min-w-0 flex-wrap gap-x-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            <bdi>{run.actorName}</bdi>
            <time dateTime={run.createdAt}>
              {hydrated ? dateTime(run.createdAt) : run.createdAt}
            </time>
          </div>
        </div>
        <QualityStatus status={run.passed ? "passed" : "failed"} t={t} />
      </div>
      <ul className="space-y-2 border-t pt-3">
        {run.results.map((result) => (
          <InspectionLine
            key={result.key}
            step={steps.get(result.key)}
            targetId={target.id}
            runId={run.id}
            result={result}
            t={t}
          />
        ))}
      </ul>
    </li>
  );
}

export function InspectionTarget({
  target,
  siteName,
  busy,
  saved,
  execute,
  refresh,
  t,
}: {
  target: QualityTargetDetail;
  siteName: string | undefined;
  busy: boolean;
  saved: () => Promise<void>;
  execute: ExecuteInspectionCommand;
  refresh: () => void;
  t: InspectionMessages;
}) {
  const number = useInspectionNumber();
  const showEditor = target.canRecord && target.status !== "passed";
  return (
    <article
      className="min-w-0 space-y-3"
      aria-labelledby="quality-target"
      data-quality-target-id={target.id}
      data-quality-status={target.status}
    >
      <div className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{t.serial}</p>
            <h2 id="quality-target" className="text-lg font-semibold [overflow-wrap:anywhere]">
              <bdi>{target.serial}</bdi>
            </h2>
          </div>
          <QualityStatus status={target.status} t={t} />
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <InspectionFact label={t.part}>
            <bdi>
              {target.partCode} · {target.partName}
            </bdi>
          </InspectionFact>
          {siteName !== undefined && (
            <InspectionFact label={t.site}>
              <bdi>{siteName}</bdi>
            </InspectionFact>
          )}
          {target.lot !== null && (
            <InspectionFact label={t.lot}>
              <bdi>{target.lot}</bdi>
            </InspectionFact>
          )}
          <InspectionFact label={t.release}>
            <bdi>{target.releaseRevision}</bdi>
          </InspectionFact>
          <InspectionFact label={t.plan}>
            <bdi>{target.plan.name}</bdi> ·{" "}
            <span>
              {t.planVersion} <bdi>{number(target.plan.version)}</bdi>
            </span>
          </InspectionFact>
        </dl>
        <p className="text-sm text-muted-foreground">
          {target.status === "passed" ? t.released : t.onHold}
        </p>
        {!showEditor && <PlanSteps steps={target.plan.steps} t={t} />}
      </div>
      {showEditor && <InspectionForm {...{ target, busy, saved, execute, refresh, t }} />}
      <section
        className="space-y-3 rounded-lg border bg-card p-3"
        aria-labelledby="quality-history"
      >
        <h3 id="quality-history" className="text-sm font-semibold">
          {t.history}
        </h3>
        {target.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noRuns}</p>
        ) : (
          <ul className="space-y-3">
            {target.runs.map((run) => (
              <InspectionRun key={run.id} {...{ run, target, t }} />
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
