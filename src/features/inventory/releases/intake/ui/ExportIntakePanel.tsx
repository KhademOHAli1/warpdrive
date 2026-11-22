"use client";

import { FilePlus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import type {
  ExportIntakeAccess,
  ExportIntakeBinding,
  ExportIntakeIssue,
  ExportIntakeJob,
  ExportIntakeResult,
} from "../contracts";
import {
  ExportBundleDialog,
  IntakeIssues,
  useIntakeKindLabels,
  type VerifiedExportBundle,
} from "./ExportBundleDialog";
import { type IntakeWords, intakeMessages } from "./messages";

type HistoryRead = { revision: number; result: ExportIntakeResult<ExportIntakeJob[]> };
const unavailable = {
  ok: false,
  issues: [{ code: "unavailable" }],
} as const satisfies ExportIntakeResult<never>;
const temporary = {
  ok: false,
  issues: [{ code: "temporary" }],
} as const satisfies ExportIntakeResult<never>;
const denied = (issues: ExportIntakeIssue[]) => issues.some(({ code }) => code === "unavailable");

function exact(a: ExportIntakeBinding, b: ExportIntakeBinding) {
  return (
    a.itemId === b.itemId &&
    a.releaseId === b.releaseId &&
    a.sku === b.sku &&
    a.revision === b.revision
  );
}

function failedAttempt(job: ExportIntakeJob) {
  const last = job.attempts.at(-1);
  return job.state === "failed" &&
    last !== undefined &&
    last.id === job.failedAttemptId &&
    last.outcome === "failed" &&
    last.issue?.code === "temporary"
    ? last.id
    : null;
}

function JobCard({
  job,
  t,
  canRetry,
  pending,
  retry,
}: {
  job: ExportIntakeJob;
  t: IntakeWords;
  canRetry: boolean;
  pending: boolean;
  retry: (jobId: string, attemptId: string) => void;
}) {
  const kinds = useIntakeKindLabels();
  const locale = useLocalePreferences();
  const hydrated = useHydrated();
  const time = (value: string) => (hydrated ? formatDateTime(value, locale) : value);
  const failureId = failedAttempt(job);
  return (
    <li
      data-export-intake-job={job.id}
      data-export-intake-state={job.state}
      className="min-w-0 space-y-2 p-3 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 wrap-anywhere">
          <p className="font-medium">
            <bdi dir="auto">
              {job.manifest.exporter.name} {job.manifest.exporter.version}
            </bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            <bdi dir="auto">{job.manifest.exporter.sourceRevision}</bdi>
            {" · "}
            <time dateTime={job.submittedAt}>{time(job.submittedAt)}</time>
          </p>
        </div>
        <Badge
          variant={
            job.state === "failed" ? "destructive" : job.state === "ready" ? "success" : "outline"
          }
        >
          {t[job.state]}
        </Badge>
      </div>
      {job.attempts.length > 0 && (
        <ol aria-label={t.attempts} className="space-y-1.5 border-s ps-2.5 text-xs">
          {job.attempts.map((attempt) => (
            <li
              key={attempt.id}
              data-export-intake-attempt={attempt.id}
              className="space-y-0.5 wrap-anywhere"
            >
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium">{t[attempt.outcome]}</span>
                <time dateTime={attempt.at} className="text-muted-foreground">
                  {time(attempt.at)}
                </time>
              </div>
              {attempt.issue !== null && (
                <p data-export-intake-issue={attempt.issue.code} className="text-muted-foreground">
                  {attempt.issue.file !== undefined && (
                    <>
                      <bdi dir="auto">{attempt.issue.file}</bdi>
                      {" · "}
                    </>
                  )}
                  {t[attempt.issue.code]}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      {job.artifacts.length > 0 && (
        <ul aria-label={t.artifacts} className="divide-y rounded-md border px-2">
          {job.artifacts.map(({ id, name, kind, sha256 }) => (
            <li
              key={id}
              data-export-intake-artifact={name}
              data-export-intake-artifact-kind={kind}
              data-export-intake-artifact-hash={sha256}
              className="space-y-0.5 py-1.5 wrap-anywhere"
            >
              <div className="flex flex-wrap justify-between gap-x-2">
                <bdi dir="auto">{name}</bdi>
                <span className="text-xs text-muted-foreground">{kinds[kind]}</span>
              </div>
              <bdi dir="ltr" className="block font-mono text-xs text-muted-foreground">
                {sha256}
              </bdi>
            </li>
          ))}
        </ul>
      )}
      {canRetry && failureId !== null && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          data-export-intake-retry={failureId}
          onClick={() => retry(job.id, failureId)}
        >
          {t.retry}
        </Button>
      )}
    </li>
  );
}

function useIntakeHistory(
  target: ExportIntakeBinding,
  access: ExportIntakeAccess,
  pending: boolean,
) {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<HistoryRead | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const rejectScope = () => setLoaded({ revision, result: unavailable });
  const inspected = loaded?.revision === revision ? loaded.result : null;
  const { itemId, releaseId, sku, revision: releaseRevision } = target;

  useEffect(() => {
    const controller = new AbortController();
    const target = { itemId, releaseId, sku, revision: releaseRevision };
    function accept(result: ExportIntakeResult<ExportIntakeJob[]>) {
      if (controller.signal.aborted) return;
      const scoped = result.ok
        ? ({ ok: true, value: result.value.filter((job) => exact(job.target, target)) } as const)
        : result;
      setLoaded({ revision, result: scoped });
    }
    void access.list(target, controller.signal).then(accept, () => accept(temporary));
    return () => controller.abort();
  }, [access, itemId, releaseId, sku, releaseRevision, revision]);

  const active =
    !pending &&
    inspected?.ok === true &&
    inspected.value.some(({ state }) => state === "queued" || state === "working");
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(reload, 2_500);
    return () => window.clearTimeout(timer);
  }, [active, reload]);
  return { inspected, reload, rejectScope };
}

function ScopedIntakePanel({
  target,
  access,
  canEdit,
}: {
  target: ExportIntakeBinding;
  access: ExportIntakeAccess;
  canEdit: boolean;
}) {
  const t = intakeMessages[useLocalePreferences().locale];
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const alive = useRef(false);
  const running = useRef(false);
  const deferredFocus = useRef(false);
  const requests = useRef(new Map<string, string>());
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<"submitted" | "retried" | null>(null);
  const [retryIssues, setRetryIssues] = useState<ExportIntakeIssue[]>([]);
  const { inspected, reload, rejectScope } = useIntakeHistory(target, access, pending);
  const blocked = inspected?.ok === false && denied(inspected.issues);
  const canWrite = canEdit && inspected?.ok === true;
  useEffect(() => {
    alive.current = true;
    function recheck() {
      if (running.current) deferredFocus.current = true;
      else reload();
    }
    window.addEventListener("focus", recheck);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", recheck);
    };
  }, [reload]);

  async function commit(
    key: string,
    send: (requestId: string) => Promise<ExportIntakeResult<ExportIntakeJob>>,
  ) {
    if (!canWrite || running.current) return unavailable;
    running.current = true;
    setPending(true);
    setNotice(null);
    const requestId = requests.current.get(key) ?? crypto.randomUUID();
    requests.current.set(key, requestId);
    try {
      const result = await send(requestId);
      if (!alive.current) return unavailable;
      if (result.ok && !exact(result.value.target, target)) {
        rejectScope();
        setOpened(false);
        return unavailable;
      }
      requests.current.delete(key);
      if (!result.ok && denied(result.issues)) {
        rejectScope();
        setOpened(false);
      } else if (result.ok) reload();
      return result;
    } catch {
      return temporary;
    } finally {
      running.current = false;
      if (alive.current) {
        setPending(false);
        if (deferredFocus.current) {
          deferredFocus.current = false;
          reload();
        }
      }
    }
  }

  async function submit({ manifest, files }: VerifiedExportBundle) {
    const result = await commit(`submit:${JSON.stringify(manifest)}`, (requestId) =>
      access.submit({ target, requestId, manifest, files }),
    );
    if (!result.ok) return result.issues;
    setOpened(false);
    setNotice("submitted");
    return [];
  }

  async function retry(jobId: string, failedAttemptId: string) {
    const job = inspected?.ok === true ? inspected.value.find(({ id }) => id === jobId) : undefined;
    if (job === undefined || failedAttempt(job) !== failedAttemptId) return;
    setRetryIssues([]);
    const result = await commit(`retry:${jobId}:${failedAttemptId}`, (requestId) =>
      access.retry({ target, requestId, jobId, failedAttemptId }),
    );
    if (!alive.current) return;
    if (!result.ok) {
      if (!denied(result.issues)) setRetryIssues(result.issues);
      return;
    }
    setNotice("retried");
    heading.current?.focus();
  }

  function restoreFocus() {
    if (trigger.current?.isConnected === true && !trigger.current.disabled) trigger.current.focus();
    else heading.current?.focus();
  }

  return (
    <section
      aria-labelledby={headingId}
      data-export-intake-history
      aria-busy={pending}
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 space-y-2 rounded-md border p-3`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h5 ref={heading} id={headingId} tabIndex={-1} className="text-sm font-semibold">
          {t.history}
        </h5>
        {!blocked && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={reload}
              disabled={pending || inspected === null}
            >
              {t.refresh}
            </Button>
            {canEdit && (
              <Button
                ref={trigger}
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !canWrite}
                data-export-intake-open
                onClick={() => {
                  setOpened(true);
                  setRetryIssues([]);
                  setNotice(null);
                }}
              >
                <FilePlus className="size-4" aria-hidden="true" /> {t.open}
              </Button>
            )}
          </div>
        )}
      </header>
      {inspected === null && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      )}
      {inspected?.ok === false && <IntakeIssues issues={inspected.issues} words={t} />}
      {inspected?.ok === true && (
        <IntakeHistoryRows
          jobs={inspected.value}
          {...{ t, pending }}
          canRetry={canWrite}
          retry={(...args) => void retry(...args)}
        />
      )}
      {!blocked && notice !== null && (
        <p data-export-intake-feedback={notice} role="status" className="text-sm text-success">
          {t[notice]}
        </p>
      )}
      {!blocked && retryIssues.length > 0 && <IntakeIssues issues={retryIssues} words={t} />}
      {opened && !blocked && canEdit && (
        <ExportBundleDialog
          {...{ target, pending, restoreFocus, submit }}
          enabled={canWrite}
          close={() => setOpened(false)}
        />
      )}
    </section>
  );
}

function IntakeHistoryRows({
  jobs,
  t,
  canRetry,
  pending,
  retry,
}: {
  jobs: ExportIntakeJob[];
  t: IntakeWords;
  canRetry: boolean;
  pending: boolean;
  retry: (jobId: string, attemptId: string) => void;
}) {
  return jobs.length === 0 ? (
    <p className="text-sm text-muted-foreground">{t.empty}</p>
  ) : (
    <ol className="divide-y rounded-md border">
      {jobs.map((job) => (
        <JobCard key={job.id} {...{ job, t, canRetry, pending, retry }} />
      ))}
    </ol>
  );
}

export function ExportIntakePanel({
  target,
  access,
  canEdit,
}: {
  target: ExportIntakeBinding;
  access?: ExportIntakeAccess;
  canEdit: boolean;
}) {
  const [source, setSource] = useState({ access, generation: 0 });
  if (source.access !== access) setSource({ access, generation: source.generation + 1 });
  if (access === undefined) return null;
  return (
    <ScopedIntakePanel
      key={JSON.stringify([
        target.itemId,
        target.releaseId,
        target.sku,
        target.revision,
        source.generation,
        canEdit,
      ])}
      {...{ target, access, canEdit }}
    />
  );
}
