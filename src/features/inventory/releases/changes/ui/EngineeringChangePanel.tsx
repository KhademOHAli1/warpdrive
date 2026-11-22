"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { manufacturingReleaseMessages } from "../../ui/manufacturingReleaseMessages";
import type {
  ChangeReview,
  EngineeringChange,
  EngineeringChangeAccess,
  EngineeringChangeCommand,
  EngineeringChangeError,
  EngineeringChangeResult,
  EngineeringChangeWorkspace,
} from "../contracts";
import {
  EngineeringChangeRows,
  EngineeringStock,
  type RunEngineeringChange,
} from "./EngineeringChangeRows";
import { EngineeringComparison } from "./EngineeringComparison";
import { type EngineeringLabels, engineeringMessages } from "./messages";

type Props = { itemId: string; access: EngineeringChangeAccess; refreshKey?: object };
type ReadState = {
  epoch: number;
  refreshKey?: object;
  observedAt: number;
  result: EngineeringChangeResult<EngineeringChangeWorkspace>;
};
type Feedback =
  | { type: "success"; action: EngineeringChangeCommand["type"] }
  | { type: "error"; error: EngineeringChangeError };
type Proposal = {
  releaseId: string;
  effectiveAt: string;
  reason: string;
  revision?: { changeId: string; expectedVersion: number };
};
const emptyProposal: Proposal = { releaseId: "", effectiveAt: "", reason: "" };
const unavailable = { ok: false, error: "unavailable" } as const;
const temporary = { ok: false, error: "temporary" } as const;

function nextCutover(workspace: EngineeringChangeWorkspace, now: number) {
  let next = Infinity;
  for (const change of workspace.changes) {
    const time = Date.parse(change.effectiveAt);
    if (change.status === "approved" && time > now) next = Math.min(next, time);
  }
  return next;
}

function useEngineeringWorkspace({ itemId, access, refreshKey }: Props) {
  const [epoch, setEpoch] = useState(0);
  const [read, setRead] = useState<ReadState | null>(null);
  const current = read?.epoch === epoch && read.refreshKey === refreshKey ? read : null;
  const reload = useCallback(() => setEpoch((value) => value + 1), []);

  useEffect(() => {
    const request = new AbortController();
    function keep(result: EngineeringChangeResult<EngineeringChangeWorkspace>) {
      if (request.signal.aborted) return;
      const coreTime =
        result.ok && result.value.observedAt !== undefined
          ? Date.parse(result.value.observedAt)
          : Number.NaN;
      setRead({
        epoch,
        refreshKey,
        observedAt: Number.isFinite(coreTime) ? coreTime : Date.now(),
        result: result.ok && result.value.itemId !== itemId ? unavailable : result,
      });
    }
    void access.read(itemId, request.signal).then(keep, () => keep(temporary));
    return () => request.abort();
  }, [access, epoch, itemId, refreshKey]);

  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  useEffect(() => {
    if (current?.result.ok !== true) return;
    const cutover = nextCutover(current.result.value, current.observedAt);
    if (!Number.isFinite(cutover)) return;
    const delay = Math.max(500, Math.min(cutover - current.observedAt, 2_147_483_647));
    const timer = window.setTimeout(reload, delay);
    return () => window.clearTimeout(timer);
  }, [current, reload]);
  return { current, reload };
}

function useChangePreview({
  itemId,
  access,
  candidateId,
  baseId,
  onUnavailable,
}: Props & { candidateId: string; baseId: string; onUnavailable: () => void }) {
  const [read, setRead] = useState<EngineeringChangeResult<ChangeReview> | null>(null);
  useEffect(() => {
    const request = new AbortController();
    function keep(result: EngineeringChangeResult<ChangeReview>) {
      if (request.signal.aborted) return;
      const matches =
        !result.ok ||
        (result.value.candidate.id === candidateId && result.value.base.id === baseId);
      if (!matches || (!result.ok && result.error === "unavailable")) {
        onUnavailable();
        return;
      }
      setRead(result);
    }
    void access.preview(itemId, candidateId, request.signal).then(keep, () => keep(temporary));
    return () => request.abort();
  }, [access, baseId, candidateId, itemId, onUnavailable]);
  return read;
}

function toUtc(value: string) {
  const date = new Date(`${value}Z`);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function ProposeChange({
  access,
  workspace,
  baseId,
  draft,
  update,
  run,
  pending,
  onUnavailable,
  t,
}: {
  access: EngineeringChangeAccess;
  workspace: EngineeringChangeWorkspace;
  baseId: string;
  draft: Proposal;
  update: (draft: Proposal) => void;
  run: RunEngineeringChange;
  pending: boolean;
  onUnavailable: () => void;
  t: EngineeringLabels;
}) {
  const { shortRevision } = manufacturingReleaseMessages[useLocale()];
  const heading = useRef<HTMLHeadingElement>(null);
  const revising = draft.revision !== undefined;
  useEffect(() => {
    if (revising) heading.current?.focus();
  }, [revising]);
  const active = new Set(
    workspace.changes
      .filter(({ status }) => status === "review" || status === "returned")
      .filter(({ id }) => id !== draft.revision?.changeId)
      .map(({ review }) => review.candidate.id),
  );
  const choices = workspace.candidates.filter(
    ({ id, status }) =>
      status === "draft" &&
      !active.has(id) &&
      (draft.revision === undefined || id === draft.releaseId),
  );
  const candidateId = choices.some(({ id }) => id === draft.releaseId) ? draft.releaseId : "";
  if (choices.length === 0 && !revising)
    return <p className="text-xs text-muted-foreground">{t.noDrafts}</p>;

  return (
    <div className="min-w-0 space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 ref={heading} tabIndex={-1} className="text-sm font-semibold">
          {revising ? t.reviseProposal : t.proposal}
        </h5>
        {revising && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => update(emptyProposal)}
          >
            {t.cancelRevision}
          </Button>
        )}
      </div>
      <div data-engineering-candidate className="min-w-0 space-y-1">
        <p className="text-xs font-medium">{t.candidate}</p>
        <Select
          ariaLabel={t.candidate}
          placeholder={t.chooseDraft}
          value={candidateId}
          options={choices.map(({ id, revision }) => ({
            value: id,
            label: `${shortRevision} ${revision}`,
          }))}
          onChange={(releaseId) => update({ ...draft, releaseId })}
          triggerClassName="w-full sm:w-56"
          contentClassName={BLOCK_CLASS}
          disabled={pending || revising}
        />
      </div>
      {candidateId !== "" && (
        <ProposeSelected
          key={JSON.stringify([baseId, candidateId])}
          {...{ access, baseId, candidateId, draft, update, run, pending, onUnavailable, t }}
          itemId={workspace.itemId}
        />
      )}
    </div>
  );
}

function ProposeSelected({
  access,
  itemId,
  baseId,
  candidateId,
  draft,
  update,
  run,
  pending,
  onUnavailable,
  t,
}: Props & {
  baseId: string;
  candidateId: string;
  draft: Proposal;
  update: (draft: Proposal) => void;
  run: RunEngineeringChange;
  pending: boolean;
  onUnavailable: () => void;
  t: EngineeringLabels;
}) {
  const dateId = useId();
  const reasonId = useId();
  const preview = useChangePreview({ itemId, access, baseId, candidateId, onUnavailable });
  if (preview === null)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t.comparing}
      </p>
    );
  if (!preview.ok)
    return (
      <p role="alert" className="text-xs text-destructive">
        {t.errors[preview.error]}
      </p>
    );

  const { ready } = preview.value;
  const effectiveAt = draft.effectiveAt === "" ? null : toUtc(draft.effectiveAt);
  const reason = draft.reason.trim();

  return (
    <form
      className="min-w-0 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || effectiveAt === null || reason === "" || pending) return;
        void run({
          type: "submit",
          revise: draft.revision,
          baseReleaseId: preview.value.base.id,
          candidateReleaseId: preview.value.candidate.id,
          fingerprint: preview.value.fingerprint,
          effectiveAt,
          reason,
        }).then((saved) => {
          if (saved) update(emptyProposal);
        });
      }}
    >
      <div
        data-engineering-preview={preview.value.candidate.id}
        data-engineering-review-ready={preview.value.ready}
        data-engineering-review-fingerprint={preview.value.fingerprint}
      >
        <EngineeringComparison review={preview.value} />
      </div>
      {!preview.value.ready && (
        <p className="text-xs text-muted-foreground">{t.errors.packageIncomplete}</p>
      )}
      <div className="grid min-w-0 gap-2">
        <label htmlFor={dateId} className="grid min-w-0 gap-1 text-xs font-medium">
          {t.effectiveAt}
          <Input
            id={dateId}
            type="datetime-local"
            step={1}
            dir="ltr"
            className="min-w-0 w-full sm:w-64"
            data-engineering-effective-at
            value={draft.effectiveAt}
            onChange={(event) => update({ ...draft, effectiveAt: event.target.value })}
            disabled={pending}
            required
          />
        </label>
        <label htmlFor={reasonId} className="grid min-w-0 gap-1 text-xs font-medium">
          {t.changeReason}
          <Textarea
            id={reasonId}
            value={draft.reason}
            data-engineering-reason
            onChange={(event) => update({ ...draft, reason: event.target.value })}
            rows={2}
            maxLength={300}
            disabled={pending}
            required
          />
        </label>
      </div>
      <Button
        size="sm"
        type="submit"
        data-engineering-submit
        disabled={!ready || pending || effectiveAt === null || reason === ""}
      >
        {draft.revision === undefined ? t.submit : t.resubmit}
      </Button>
    </form>
  );
}

function ScopedEngineeringChangePanel({ itemId, access, refreshKey }: Props) {
  const t = engineeringMessages[useLocale()];
  const heading = useId();
  const { current, reload } = useEngineeringWorkspace({ itemId, access, refreshKey });
  const [draft, setDraft] = useState(emptyProposal);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);
  const onUnavailable = useCallback(() => {
    setDraft(emptyProposal);
    setFeedback({ type: "error", error: "unavailable" });
    reload();
  }, [reload]);
  const intentIds = useRef(new Map<string, string>());
  const executing = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const workspace = current?.result.ok === true ? current.result.value : null;
  const run: RunEngineeringChange = async (intent) => {
    if (executing.current || workspace === null) return false;
    executing.current = true;
    setPending(true);
    setFeedback(null);
    const key = JSON.stringify(intent);
    const requestId = intentIds.current.get(key) ?? crypto.randomUUID();
    intentIds.current.set(key, requestId);
    try {
      const result = await access.execute({ ...intent, itemId, requestId });
      if (!alive.current) return false;
      if (!result.ok && result.error === "temporary") {
        setFeedback({ type: "error", error: "temporary" });
        return false;
      }
      intentIds.current.delete(key);
      if (result.ok) {
        const matches = result.value.itemId === itemId;
        setFeedback(
          matches
            ? { type: "success", action: intent.type }
            : { type: "error", error: "unavailable" },
        );
        reload();
        return matches;
      }
      setFeedback({ type: "error", error: result.error });
      if (
        result.error === "unavailable" ||
        result.error === "staleReview" ||
        result.error === "conflict"
      ) {
        reload();
      }
      return false;
    } catch {
      if (alive.current) setFeedback({ type: "error", error: "temporary" });
      return false;
    } finally {
      executing.current = false;
      if (alive.current) setPending(false);
    }
  };

  function revise(change: EngineeringChange) {
    setDraft({
      releaseId: change.review.candidate.id,
      effectiveAt: change.effectiveAt.slice(0, 19),
      reason: change.reason,
      revision: { changeId: change.id, expectedVersion: change.version },
    });
  }

  return (
    <section
      aria-labelledby={heading}
      aria-busy={pending || current === null}
      data-engineering-changes
      className={`${BLOCK_CLASS} ph-no-capture min-w-0 space-y-3 rounded-md border px-3 py-3`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={heading} className="text-sm font-semibold">
          {t.heading}
        </h4>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          onClick={reload}
          disabled={pending || current === null}
          data-engineering-refresh
        >
          {t.refresh}
        </Button>
      </header>
      {current === null && (
        <p role="status" className="text-xs text-muted-foreground">
          {t.loading}
        </p>
      )}
      {current?.result.ok === false && (
        <p role="alert" className="text-xs text-destructive">
          {t.errors[current.result.error]}
        </p>
      )}
      {feedback?.type === "success" && (
        <p role="status" className="text-xs text-success">
          {t.notices[feedback.action]}
        </p>
      )}
      {feedback?.type === "error" &&
        (current?.result.ok !== false || current.result.error !== feedback.error) && (
          <p role="alert" className="text-xs text-destructive">
            {t.errors[feedback.error]}
          </p>
        )}
      {workspace !== null && current !== null && (
        <>
          <div
            className="space-y-1 rounded-md border bg-muted/25 p-2.5"
            data-engineering-effective-release={workspace.effectiveRelease?.id ?? ""}
          >
            <p className="text-xs text-muted-foreground">{t.effectiveRelease}</p>
            <p className="text-sm font-medium">
              {workspace.effectiveRelease === null ? (
                t.noEffectiveRelease
              ) : (
                <bdi>{workspace.effectiveRelease.revision}</bdi>
              )}
            </p>
          </div>
          {workspace.canPropose && workspace.effectiveRelease !== null && (
            <ProposeChange
              {...{ access, workspace, draft, run, pending, onUnavailable, t }}
              baseId={workspace.effectiveRelease.id}
              update={setDraft}
            />
          )}
          <EngineeringChangeRows
            {...{ workspace, pending, revise, run }}
            observedAt={current.observedAt}
          />
          {workspace.stock !== null && (
            <EngineeringStock stock={workspace.stock} {...{ pending, run }} />
          )}
        </>
      )}
    </section>
  );
}

export function EngineeringChangePanel({ itemId, access, refreshKey }: Props) {
  const [scope, setScope] = useState({ itemId, access, generation: 0 });
  if (scope.itemId !== itemId || scope.access !== access) {
    setScope({ itemId, access, generation: scope.generation + 1 });
    return null;
  }
  return (
    <ScopedEngineeringChangePanel key={scope.generation} {...{ itemId, access, refreshKey }} />
  );
}
