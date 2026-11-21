"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/RadioGroup";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { type FormattingLocaleTag, localeTagForFormatting } from "@/lib/localeFormatting";
import { useFormatters } from "@/lib/useFormatters";
import { useHydrated } from "@/lib/useHydrated";
import { normalizeNumberInput } from "@/utils/normalizeNumberInput";
import { CatalogField } from "../../catalog/ui/CatalogFields";
import {
  maxQualityEvidenceBytes,
  type QualityCommand,
  type QualityCommandResult,
  type QualityError,
  type QualityStepDraft,
  type QualityTargetDetail,
} from "../contracts";
import type { InspectionMessages } from "./inspectionMessages";

type RunResult = Extract<QualityCommand, { type: "recordRun" }>["results"][number];
type DraftResult = { actual: string; files: File[] };
type DraftEntry = { key: string; actual: RunResult["actual"]; files: File[] };
type Feedback = {
  key?: string;
  code: QualityError | "invalidMeasurement" | "invalidCheck" | "evidenceNeeded" | "transport";
};
type PendingEvidence = { id: string; post: { url: string; fields: Record<string, string> } };
type EvidenceUpload = { pending: PendingEvidence; transferred: boolean; confirmed: boolean };
export type ExecuteInspectionCommand = (command: QualityCommand) => Promise<QualityCommandResult>;

const draftResult: DraftResult = { actual: "", files: [] };
const fileExtensions = /\.(pdf|png|jpe?g|csv|txt)$/i;

function prepareResult(
  step: QualityStepDraft,
  draft: DraftResult,
  locale: FormattingLocaleTag,
): { actual: RunResult["actual"] } | { error: Feedback["code"] } {
  if (step.evidenceRequired && draft.files.length === 0) return { error: "evidenceNeeded" };
  if (
    draft.files.length > 4 ||
    draft.files.some(
      (file) =>
        file.size <= 0 || file.size > maxQualityEvidenceBytes || !fileExtensions.test(file.name),
    )
  )
    return { error: "evidence" };
  if (step.kind === "check") {
    if (draft.actual !== "pass" && draft.actual !== "fail") return { error: "invalidCheck" };
    return { actual: draft.actual === "pass" };
  }
  const raw = normalizeNumberInput(draft.actual, locale);
  if (raw === null) return { error: "invalidMeasurement" };
  const actual = Number(raw);
  return Number.isFinite(actual) ? { actual } : { error: "invalidMeasurement" };
}

function prepareEntries(
  steps: QualityStepDraft[],
  drafts: Record<string, DraftResult>,
  locale: FormattingLocaleTag,
): { entries: DraftEntry[] } | { feedback: Feedback } {
  const entries: DraftEntry[] = [];
  for (const step of steps) {
    const draft = drafts[step.key] ?? draftResult;
    const prepared = prepareResult(step, draft, locale);
    if ("error" in prepared) return { feedback: { key: step.key, code: prepared.error } };
    entries.push({ key: step.key, actual: prepared.actual, files: draft.files });
  }
  return { entries };
}

async function requestEvidence(
  targetId: string,
  key: string,
  file: File,
  execute: ExecuteInspectionCommand,
): Promise<{ pending: PendingEvidence } | { error: QualityError }> {
  const requested = await execute({
    type: "requestEvidence",
    targetId,
    key,
    name: file.name,
    sizeBytes: file.size,
  });
  if (!requested.ok) return { error: requested.error };
  const { post, evidenceId } = requested.value;
  if (post === undefined || evidenceId === undefined) return { error: "evidence" };
  return { pending: { id: evidenceId, post } };
}

async function uploadEvidence(
  targetId: string,
  key: string,
  file: File,
  cache: Map<File, EvidenceUpload>,
  execute: ExecuteInspectionCommand,
): Promise<{ id: string } | { error: QualityError }> {
  let upload = cache.get(file);
  if (upload === undefined) {
    const requested = await requestEvidence(targetId, key, file, execute);
    if ("error" in requested) return requested;
    upload = { pending: requested.pending, transferred: false, confirmed: false };
    cache.set(file, upload);
  }
  if (!upload.transferred) {
    const body = new FormData();
    for (const [field, value] of Object.entries(upload.pending.post.fields))
      body.append(field, value);
    body.append("file", file);
    const response = await fetch(upload.pending.post.url, {
      method: "POST",
      body,
      credentials: "omit",
    });
    if (!response.ok) {
      cache.delete(file);
      return { error: "evidence" };
    }
    upload.transferred = true;
  }
  if (!upload.confirmed) {
    const confirmed = await execute({
      type: "confirmEvidence",
      targetId,
      evidenceId: upload.pending.id,
    });
    if (!confirmed.ok) {
      if (confirmed.error === "evidence") cache.delete(file);
      return { error: confirmed.error };
    }
    upload.confirmed = true;
  }
  return { id: upload.pending.id };
}

async function collectEvidence(
  targetId: string,
  entries: DraftEntry[],
  cache: Map<File, EvidenceUpload>,
  execute: ExecuteInspectionCommand,
): Promise<{ results: RunResult[] } | { feedback: Feedback }> {
  const results: RunResult[] = [];
  for (const { key, files, actual } of entries) {
    const evidenceIds: string[] = [];
    for (const file of files) {
      const uploaded = await uploadEvidence(targetId, key, file, cache, execute);
      if ("error" in uploaded) return { feedback: { key, code: uploaded.error } };
      evidenceIds.push(uploaded.id);
    }
    results.push({ key, actual, evidenceIds });
  }
  return { results };
}

function InspectionStepFields({
  step,
  draft,
  feedback,
  change,
  disabled,
  t,
}: {
  step: QualityStepDraft;
  draft: DraftResult;
  feedback: Feedback | null;
  change: (next: DraftResult) => void;
  disabled: boolean;
  t: InspectionMessages;
}) {
  const stem = useId();
  const { number } = useFormatters();
  const hydrated = useHydrated();
  const display = (value: number) =>
    hydrated ? number(value, { maximumSignificantDigits: 17 }) : String(value);
  const problem = feedback?.key === step.key ? `${stem}-problem` : undefined;
  const limits = step.kind === "measurement" ? `${stem}-limits` : undefined;
  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border px-3 pb-3" disabled={disabled}>
      <legend className="max-w-full break-words px-1 text-sm font-medium">
        <bdi>{step.label}</bdi>
      </legend>
      {step.kind === "measurement" ? (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          <CatalogField id={`${stem}-actual`} label={`${t.actual} (${step.unit})`}>
            <Input
              id={`${stem}-actual`}
              value={draft.actual}
              inputMode="decimal"
              dir="ltr"
              maxLength={64}
              required
              disabled={disabled}
              aria-describedby={[limits, problem].filter(Boolean).join(" ")}
              aria-invalid={feedback?.key === step.key && feedback.code === "invalidMeasurement"}
              onChange={(event) => change({ ...draft, actual: event.target.value })}
            />
          </CatalogField>
          <dl className="flex flex-wrap gap-x-4 text-sm" id={limits}>
            {step.minimum !== null && (
              <div>
                <dt className="text-xs text-muted-foreground">{t.minimum}</dt>
                <dd className="tabular-nums">
                  <bdi>
                    {display(step.minimum)} {step.unit}
                  </bdi>
                </dd>
              </div>
            )}
            {step.maximum !== null && (
              <div>
                <dt className="text-xs text-muted-foreground">{t.maximum}</dt>
                <dd className="tabular-nums">
                  <bdi>
                    {display(step.maximum)} {step.unit}
                  </bdi>
                </dd>
              </div>
            )}
          </dl>
        </div>
      ) : (
        <RadioGroup
          aria-label={step.label}
          aria-describedby={problem}
          aria-invalid={feedback?.key === step.key && feedback.code === "invalidCheck"}
          name={stem}
          required
          disabled={disabled}
          value={draft.actual}
          onValueChange={(actual) => change({ ...draft, actual })}
          className="flex flex-wrap gap-4"
        >
          <label htmlFor={`${stem}-pass`} className="inline-flex items-center gap-2 text-sm">
            <RadioGroupItem id={`${stem}-pass`} value="pass" /> {t.passCheck}
          </label>
          <label htmlFor={`${stem}-fail`} className="inline-flex items-center gap-2 text-sm">
            <RadioGroupItem id={`${stem}-fail`} value="fail" /> {t.failCheck}
          </label>
        </RadioGroup>
      )}
      <CatalogField
        id={`${stem}-files`}
        label={step.evidenceRequired ? t.requiredEvidence : t.evidenceFile}
      >
        <Input
          id={`${stem}-files`}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.csv,.txt"
          multiple
          required={step.evidenceRequired}
          disabled={disabled}
          aria-describedby={[`${stem}-file-formats`, problem].filter(Boolean).join(" ")}
          aria-invalid={
            feedback?.key === step.key &&
            (feedback.code === "evidence" || feedback.code === "evidenceNeeded")
          }
          onChange={(event) => change({ ...draft, files: Array.from(event.target.files ?? []) })}
        />
        <p id={`${stem}-file-formats`} className="text-xs text-muted-foreground">
          {t.evidenceFormats}
        </p>
      </CatalogField>
      {feedback !== null && feedback.key === step.key && (
        <p id={problem} role="alert" className="text-sm text-destructive">
          {t[feedback.code]}
        </p>
      )}
    </fieldset>
  );
}

export function InspectionForm({
  target,
  busy,
  saved,
  execute,
  refresh,
  t,
}: {
  target: QualityTargetDetail;
  busy: boolean;
  saved: () => Promise<void>;
  execute: ExecuteInspectionCommand;
  refresh: () => void;
  t: InspectionMessages;
}) {
  const locale = localeTagForFormatting(useLocalePreferences());
  const id = useId();
  const [station, setStation] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftResult>>({});
  const [pending, setPending] = useState<"uploading" | "submitting" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const active = useRef(false);
  const uploadCache = useRef(new Map<File, EvidenceUpload>());
  const attempted = useRef<{ payload: string; requestId: string } | null>(null);
  const disabled = busy || pending !== null;

  function showFailure(failure: Feedback) {
    setFeedback(failure);
    if (failure.code === "state" || failure.code === "unavailable" || failure.code === "conflict")
      refresh();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || disabled) return;
    const form = event.currentTarget;
    const stationName = station.trim();
    if (stationName === "") {
      setFeedback({ code: "invalid" });
      return;
    }
    const prepared = prepareEntries(target.plan.steps, drafts, locale);
    if ("feedback" in prepared) {
      setFeedback(prepared.feedback);
      return;
    }
    active.current = true;
    setFeedback(null);
    setPending(prepared.entries.some(({ files }) => files.length > 0) ? "uploading" : "submitting");
    try {
      const collected = await collectEvidence(
        target.id,
        prepared.entries,
        uploadCache.current,
        execute,
      );
      if ("feedback" in collected) {
        showFailure(collected.feedback);
        return;
      }
      const { results } = collected;
      setPending("submitting");
      const payload = JSON.stringify({ station: stationName, results });
      const requestId =
        attempted.current?.payload === payload ? attempted.current.requestId : crypto.randomUUID();
      attempted.current = { payload, requestId };
      const recorded = await execute({
        type: "recordRun",
        targetId: target.id,
        requestId,
        station: stationName,
        results,
      });
      if (!recorded.ok) {
        showFailure({ code: recorded.error });
        if (recorded.error === "evidence") uploadCache.current.clear();
        return;
      }
      attempted.current = null;
      uploadCache.current.clear();
      form.reset();
      setDrafts({});
      await saved();
    } catch {
      setFeedback({ code: "transport" });
    } finally {
      active.current = false;
      setPending(null);
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border bg-card p-3"
      aria-labelledby={`${id}-heading`}
      aria-busy={pending !== null}
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="text-sm font-semibold" id={`${id}-heading`}>
        {target.runs.length === 0 ? t.recordRun : t.recordRetest}
      </h3>
      <div className="max-w-sm">
        <CatalogField id={`${id}-station`} label={t.station}>
          <Input
            id={`${id}-station`}
            value={station}
            onChange={(event) => setStation(event.target.value)}
            maxLength={100}
            required
            disabled={disabled}
          />
        </CatalogField>
      </div>
      {target.plan.steps.map((step) => (
        <InspectionStepFields
          key={step.key}
          step={step}
          draft={drafts[step.key] ?? draftResult}
          feedback={feedback}
          change={(next) => setDrafts((current) => ({ ...current, [step.key]: next }))}
          disabled={disabled}
          t={t}
        />
      ))}
      {feedback !== null && feedback.key === undefined && (
        <p role="alert" className="text-sm text-destructive">
          {t[feedback.code]}
        </p>
      )}
      <Button type="submit" size="sm" disabled={disabled} data-quality-action="recordRun">
        {pending === null ? t.submit : t[pending]}
      </Button>
    </form>
  );
}
