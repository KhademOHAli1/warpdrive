"use client";

import Link from "next/link";
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { CatalogCheckbox } from "@/features/inventory/catalog/ui/CatalogFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import { EditorSelect } from "../../../ui/AssetEditorFields";
import type { BookingSite } from "../../contracts";
import {
  type BookingAutomationAccess,
  type BookingAutomationProfile,
  type BookingAutomationResult,
  type BookingAutomationRun,
  type BookingAutomationRuns,
  type BookingAutomationState,
  type BookingAutomationTrigger,
  bookingAutomationRefreshMs,
  bookingAutomationTriggers,
} from "../contracts";
import { bookingAutomationTriggerLabels } from "../messages";
import {
  type AutomationSettingsWords,
  automationSettingsMessages,
} from "./automationSettingsMessages";

const filters = ["all", "pending", "delivered", "failed", "skipped"] as const;
type RunFilter = (typeof filters)[number];
type Failure = Extract<BookingAutomationResult<unknown>, { ok: false }>["error"];
type ReadResult =
  | BookingAutomationResult<BookingAutomationRuns>
  | { ok: false; error: "transport" };
type Feedback = Failure | "transport" | "saved" | "retried";
type Query = { status: RunFilter; cursors: string[] };
type TriggerLabels = Record<BookingAutomationTrigger, string>;

function useAutomationRuns(siteId: string, read: BookingAutomationAccess["readRuns"]) {
  const [query, setQuery] = useState<Query>({ status: "all", cursors: [] });
  const [loaded, setLoaded] = useState<{ query: Query; result: ReadResult } | null>(null);
  const [profile, setProfile] = useState<BookingAutomationProfile | null>(null);
  const reload = useCallback(() => setQuery((current) => ({ ...current })), []);
  useEffect(() => {
    const controller = new AbortController();
    const cursor = query.cursors.at(-1);
    const status: BookingAutomationState | undefined =
      query.status === "all" ? undefined : query.status;
    const accept = (result: ReadResult) => {
      if (controller.signal.aborted) return;
      setLoaded({ query, result });
      if (result.ok) {
        const next = result.value.profile;
        setProfile((current) =>
          current !== null && current.version > next.version ? current : next,
        );
      } else if (result.error === "unavailable") {
        setProfile(null);
      }
    };
    void read({ siteId, status, cursor }, controller.signal).then(accept, () =>
      accept({ ok: false, error: "transport" }),
    );
    return () => controller.abort();
  }, [query, read, siteId]);
  return {
    result: loaded?.query === query ? loaded.result : null,
    profile,
    setProfile,
    filter: query.status,
    canGoBack: query.cursors.length > 0,
    changeFilter: (status: RunFilter) => setQuery({ status, cursors: [] }),
    previous: () => setQuery((current) => ({ ...current, cursors: current.cursors.slice(0, -1) })),
    next: (cursor: string) =>
      setQuery((current) => ({ ...current, cursors: [...current.cursors, cursor] })),
    reload,
    resetPagination: () => setQuery((current) => ({ ...current, cursors: [] })),
    deny() {
      setLoaded({ query, result: { ok: false, error: "unavailable" } });
      setProfile(null);
    },
  };
}

function currentFailure(run: BookingAutomationRun): string | null {
  if (run.state !== "failed" || run.failureId === null) return null;
  return run.attempts.some(({ id, outcome }) => id === run.failureId && outcome === "failed")
    ? run.failureId
    : null;
}

function NotificationRules({
  profile,
  busy,
  editable,
  save,
  words: t,
  triggers,
}: {
  profile: BookingAutomationProfile;
  busy: boolean;
  editable: boolean;
  save: (triggers: BookingAutomationTrigger[]) => void;
  words: AutomationSettingsWords;
  triggers: TriggerLabels;
}) {
  const checkboxId = useId();
  const [draft, setDraft] = useState(profile.triggers);
  function toggle(rule: BookingAutomationTrigger, enabled: boolean) {
    const next = enabled ? [...draft, rule] : draft.filter((trigger) => trigger !== rule);
    setDraft(bookingAutomationTriggers.filter((trigger) => next.includes(trigger)));
  }
  const changed = bookingAutomationTriggers.some(
    (trigger) => draft.includes(trigger) !== profile.triggers.includes(trigger),
  );
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed && editable && !busy) save(draft);
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t.rules}</legend>
        <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          {bookingAutomationTriggers.map((trigger) => (
            <div key={trigger} data-booking-automation-rule={trigger}>
              <CatalogCheckbox
                id={`${checkboxId}-${trigger}`}
                label={triggers[trigger]}
                checked={draft.includes(trigger)}
                disabled={!editable || busy}
                change={(enabled) => toggle(trigger, enabled)}
              />
            </div>
          ))}
        </div>
      </fieldset>
      {editable && (
        <Button type="submit" size="sm" disabled={busy || !changed} data-booking-automation-save>
          {t.save}
        </Button>
      )}
    </form>
  );
}

function RunCard({
  run,
  words: t,
  triggers,
  time,
  busy,
  demo,
  retry,
}: {
  run: BookingAutomationRun;
  words: AutomationSettingsWords;
  triggers: TriggerLabels;
  time: (value: string) => string;
  busy: boolean;
  demo: boolean;
  retry?: (runId: string, failureId: string) => void;
}) {
  const failureId = currentFailure(run);
  const bookingHref = {
    pathname: "/assets/bookings",
    query: { bookingId: run.bookingId, ...(demo ? { demo: "automations" } : {}) },
  };
  return (
    <li
      data-booking-automation-run={run.id}
      data-booking-automation-state={run.state}
      className="space-y-2 p-3 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 wrap-anywhere">
          <h4 className="font-medium">
            <Link
              href={bookingHref}
              prefetch={false}
              data-booking-automation-link
              className="rounded-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <bdi dir="auto">{run.title}</bdi>
            </Link>
          </h4>
          <p className="text-xs text-muted-foreground">{triggers[run.trigger]}</p>
        </div>
        <Badge variant={run.state === "failed" ? "destructive" : "outline"}>{t[run.state]}</Badge>
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0 wrap-anywhere">
          <dt className="text-muted-foreground">{t.scheduled}</dt>
          <dd>
            <time dateTime={run.scheduledAt}>{time(run.scheduledAt)}</time>
          </dd>
        </div>
        {run.dueAt !== null && (
          <div className="min-w-0 wrap-anywhere">
            <dt className="text-muted-foreground">{t.due}</dt>
            <dd>
              <time dateTime={run.dueAt}>{time(run.dueAt)}</time>
            </dd>
          </div>
        )}
        <div className="min-w-0 wrap-anywhere">
          <dt className="text-muted-foreground">{t.recipient}</dt>
          <dd>
            <bdi dir="auto">{run.recipientName ?? t.noRecipient}</bdi>
          </dd>
        </div>
      </dl>
      {run.attempts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noAttempts}</p>
      ) : (
        <ol aria-label={t.attempts} className="space-y-1.5 border-s ps-2.5 text-xs">
          {run.attempts.map((attempt) => (
            <li
              key={attempt.id}
              data-booking-automation-attempt={attempt.id}
              className="flex flex-wrap gap-x-2 gap-y-1 wrap-anywhere"
            >
              <span className="font-medium">{t[attempt.outcome]}</span>
              <time dateTime={attempt.at} className="text-muted-foreground">
                {time(attempt.at)}
              </time>
              {attempt.reason !== null && (
                <span className="text-muted-foreground">{t[attempt.reason]}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {retry !== undefined && failureId !== null && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          data-booking-automation-retry={failureId}
          onClick={() => retry(run.id, failureId)}
        >
          {t.retry}
        </Button>
      )}
    </li>
  );
}

function RunHistory({
  view,
  pending,
  title,
  words: t,
  triggers,
  time,
  retry,
  demo,
}: {
  view: ReturnType<typeof useAutomationRuns>;
  pending: boolean;
  title: RefObject<HTMLHeadingElement | null>;
  words: AutomationSettingsWords;
  triggers: TriggerLabels;
  time: (value: string) => string;
  retry?: (runId: string, failureId: string) => void;
  demo: boolean;
}) {
  const historyId = useId();
  const { result } = view;
  const denied = result?.ok === false && result.error === "unavailable";
  const next = result?.ok === true ? result.value.nextCursor : null;
  const options = filters.map((value) => ({ value, label: t[value] }));
  return (
    <section
      aria-labelledby={historyId}
      data-booking-automation-history
      className="space-y-3 border-t pt-3"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 ref={title} id={historyId} tabIndex={-1} className="text-sm font-semibold">
          {t.history}
        </h3>
        {!denied && (
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <div className="min-w-0 max-w-full sm:w-48">
              <EditorSelect
                label={t.filter}
                value={view.filter}
                disabled={pending}
                options={options}
                onChange={(value) => {
                  const status = filters.find((filter) => filter === value);
                  if (status !== undefined && status !== view.filter) view.changeFilter(status);
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || result === null}
              onClick={view.reload}
            >
              {t.refresh}
            </Button>
          </div>
        )}
      </div>
      {result === null && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      )}
      {result?.ok === false && (
        <p role="alert" className="text-sm">
          {t[result.error]}
        </p>
      )}
      {result?.ok === true &&
        (result.value.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.noRuns}</p>
        ) : (
          <ol className="divide-y rounded-md border">
            {result.value.runs.map((run) => (
              <RunCard
                key={run.id}
                {...{ run, triggers, time, retry, demo }}
                busy={pending}
                words={t}
              />
            ))}
          </ol>
        ))}
      {!denied && (view.canGoBack || next !== null) && (
        <nav aria-label={t.pagination} className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!view.canGoBack || pending || result === null}
            onClick={view.previous}
          >
            {t.previous}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={next === null || pending}
            onClick={() => {
              if (next !== null) view.next(next);
            }}
          >
            {t.next}
          </Button>
        </nav>
      )}
    </section>
  );
}

function AutomationSettings({
  site,
  access,
  demo,
}: {
  site: BookingSite;
  access: BookingAutomationAccess;
  demo: boolean;
}) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  const t = automationSettingsMessages[preferences.locale];
  const triggers = bookingAutomationTriggerLabels[preferences.locale];
  const view = useAutomationRuns(site.id, access.readRuns);
  const { reload } = view;
  const title = useRef<HTMLHeadingElement>(null);
  const ready = view.result?.ok === true;
  const editable = site.archived !== true;
  const alive = useRef(false);
  const writing = useRef(false);
  const focusDeferred = useRef(false);
  const unresolved = useRef(new Map<string, string>());
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => {
    alive.current = true;
    function recheck() {
      if (writing.current) focusDeferred.current = true;
      else reload();
    }
    window.addEventListener("focus", recheck);
    const interval = window.setInterval(() => {
      if (!document.hidden) recheck();
    }, bookingAutomationRefreshMs);
    return () => {
      alive.current = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", recheck);
    };
  }, [reload]);

  async function mutate<T>(
    signature: string,
    run: (requestId: string) => Promise<BookingAutomationResult<T>>,
    update: (value: T) => void,
  ) {
    if (writing.current || !editable || !ready) return;
    writing.current = true;
    setPending(true);
    setFeedback(null);
    const requestId = unresolved.current.get(signature) ?? crypto.randomUUID();
    unresolved.current.set(signature, requestId);
    try {
      const result = await run(requestId);
      if (!alive.current) return;
      unresolved.current.delete(signature);
      if (result.ok) update(result.value);
      else {
        setFeedback(result.error);
        if (result.error === "unavailable") view.deny();
        if (result.error === "conflict") view.reload();
      }
    } catch {
      if (alive.current) setFeedback("transport");
    } finally {
      writing.current = false;
      if (alive.current) {
        setPending(false);
        if (focusDeferred.current) {
          focusDeferred.current = false;
          reload();
        }
      }
    }
  }

  function save(next: BookingAutomationTrigger[]) {
    if (view.profile === null) return;
    const input = { siteId: site.id, version: view.profile.version, triggers: next };
    void mutate(
      `profile:${JSON.stringify(input)}`,
      (requestId) => access.saveProfile({ ...input, requestId }),
      (profile) => {
        view.setProfile(profile);
        setFeedback("saved");
      },
    );
  }

  function retry(runId: string, failureId: string) {
    const run =
      view.result?.ok === true ? view.result.value.runs.find(({ id }) => id === runId) : undefined;
    if (run === undefined || currentFailure(run) !== failureId) return;
    const input = { siteId: site.id, runId, failureId };
    void mutate(
      `retry:${runId}:${failureId}`,
      (requestId) => access.retry({ ...input, requestId }),
      () => {
        view.resetPagination();
        setFeedback("retried");
        title.current?.focus();
      },
    );
  }

  const time = (value: string) =>
    hydrated ? formatDateTime(value, { ...preferences, timeZone: site.policy.timeZone }) : value;
  return (
    <section
      aria-label={t.heading}
      aria-busy={pending}
      data-booking-automation
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 space-y-3 rounded-lg border bg-card p-4`}
    >
      <header className="space-y-1">
        <h2 className="text-sm font-semibold">{t.heading}</h2>
        <p className="text-sm text-muted-foreground">{editable ? t.description : t.archived}</p>
      </header>
      {view.profile !== null && (
        <NotificationRules
          key={view.profile.version}
          profile={view.profile}
          busy={pending || !ready}
          {...{ editable, save, triggers }}
          words={t}
        />
      )}
      {feedback !== null && feedback !== "unavailable" && (
        <p
          role={feedback === "retried" || feedback === "saved" ? "status" : "alert"}
          data-booking-automation-feedback={feedback}
          className="text-sm"
        >
          {t[feedback]}
        </p>
      )}
      <RunHistory
        {...{ view, pending, title, triggers, time, demo }}
        retry={editable ? retry : undefined}
        words={t}
      />
    </section>
  );
}

export function BookingAutomationSettings({
  site,
  access,
  demo = false,
}: {
  site: BookingSite;
  access: BookingAutomationAccess;
  demo?: boolean;
}) {
  const [source, setSource] = useState({ access, generation: 0 });
  if (source.access !== access) setSource({ access, generation: source.generation + 1 });
  if (site.role !== "manager") return null;
  return (
    <AutomationSettings
      key={`${site.id}:${site.archived === true}:${source.generation}`}
      {...{ site, access, demo }}
    />
  );
}
