"use client";

import { type ReactNode, useId, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import type {
  EngineeringChange,
  EngineeringChangeCommand,
  EngineeringChangeWorkspace,
  OldReleasePosition,
} from "../contracts";
import { EngineeringComparison } from "./EngineeringComparison";
import { type EngineeringLabels, engineeringMessages } from "./messages";

type WithoutScope<T> = T extends EngineeringChangeCommand ? Omit<T, "itemId" | "requestId"> : never;
export type EngineeringIntent = WithoutScope<EngineeringChangeCommand>;
export type RunEngineeringChange = (intent: EngineeringIntent) => Promise<boolean>;

function ReviewTime({ value, utc = false }: { value: string; utc?: boolean }) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  const regional = utc ? { ...preferences, timeZone: "UTC" } : preferences;
  return (
    <time dateTime={value} data-engineering-cutover={utc ? "" : undefined}>
      {hydrated ? formatDateTime(value, regional) : value}
      {utc && ` ${engineeringMessages[preferences.locale].utc}`}
    </time>
  );
}

function ReasonForm({
  label,
  action,
  pending,
  submit,
  kind,
}: {
  label: string;
  action: string;
  pending: boolean;
  submit: (reason: string) => Promise<boolean>;
  kind: "return" | "hold" | "release";
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex min-w-0 flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const note = reason.trim();
        if (note === "" || pending) return;
        void submit(note).then((saved) => {
          if (saved) setReason("");
        });
      }}
    >
      <label htmlFor={id} className="grid min-w-32 flex-1 gap-1 text-xs font-medium">
        {label}
        <Textarea
          id={id}
          className="min-h-12"
          rows={2}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          disabled={pending}
          required
          data-engineering-return-note={kind === "return" ? "" : undefined}
          data-engineering-stock-reason={kind !== "return" ? "" : undefined}
        />
      </label>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || reason.trim() === ""}
        data-engineering-return={kind === "return" ? "" : undefined}
        data-engineering-disposition={kind !== "return" ? kind : undefined}
      >
        {action}
      </Button>
    </form>
  );
}

function History({
  title,
  entries,
  stock,
}: {
  title: string;
  entries: { id: string; label: string; at: string; actor: string; note: string | null }[];
  stock?: boolean;
}) {
  if (entries.length === 0) return null;
  const marker =
    stock === true ? { "data-engineering-stock-history": "" } : { "data-engineering-history": "" };
  return (
    <section aria-label={title} className="space-y-1.5" {...marker}>
      <h5 className="text-xs font-medium text-muted-foreground">{title}</h5>
      <ol className="divide-y rounded-md border px-2.5">
        {entries.map(({ id, label, at, actor, note }) => (
          <li key={id} className="space-y-1 py-1.5 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{label}</span>
              <bdi className="wrap-anywhere">{actor}</bdi>
              <span className="text-muted-foreground">
                <ReviewTime value={at} />
              </span>
            </div>
            {note !== null && (
              <p className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">
                <bdi>{note}</bdi>
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ChangeRow({
  change,
  status,
  canPropose,
  canDecide,
  pending,
  revise,
  run,
  t,
}: {
  change: EngineeringChange;
  status: EngineeringChange["status"] | "scheduled" | "effective";
  canPropose: boolean;
  canDecide: boolean;
  pending: boolean;
  revise: (change: EngineeringChange) => void;
  run: RunEngineeringChange;
  t: EngineeringLabels;
}) {
  const target = { changeId: change.id, expectedVersion: change.version };
  const canWithdraw = canPropose && (change.status === "review" || change.status === "returned");
  const canReturn = canDecide && change.status === "review";
  return (
    <li
      data-engineering-change={change.id}
      data-engineering-status={status}
      className="min-w-0 space-y-3 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h5 className="text-sm font-semibold">
          <bdi dir="ltr">
            {change.review.base.revision} → {change.review.candidate.revision}
          </bdi>
        </h5>
        <Badge variant={status === "effective" || status === "approved" ? "success" : "outline"}>
          {t[status]}
        </Badge>
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t.changeReason}</dt>
          <dd className="whitespace-pre-wrap wrap-anywhere">
            <bdi>{change.reason}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.effectiveAt}</dt>
          <dd>
            <ReviewTime value={change.effectiveAt} utc />
          </dd>
        </div>
      </dl>
      <details className="min-w-0 space-y-2" open={change.status === "review" || undefined}>
        <summary className="w-fit cursor-pointer text-xs font-medium text-foreground">
          {t.submittedComparison}
        </summary>
        <EngineeringComparison review={change.review} />
      </details>
      <History
        title={t.submittedBy}
        entries={change.history.map((entry) => ({ ...entry, label: t[entry.type] }))}
      />
      {(canReturn || canWithdraw) && (
        <div className="flex flex-wrap gap-2">
          {canReturn && (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              data-engineering-approve
              onClick={() =>
                void run({ ...target, type: "approve", fingerprint: change.review.fingerprint })
              }
            >
              {t.approve}
            </Button>
          )}
          {canPropose && change.status === "returned" && (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              data-engineering-revise
              onClick={() => revise(change)}
            >
              {t.revise}
            </Button>
          )}
          {canWithdraw && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              data-engineering-withdraw
              onClick={() => void run({ ...target, type: "withdraw" })}
            >
              {t.withdraw}
            </Button>
          )}
        </div>
      )}
      {canReturn && (
        <ReasonForm
          label={t.returnNote}
          action={t.sendBack}
          pending={pending}
          kind="return"
          submit={(note) => run({ ...target, type: "return", note })}
        />
      )}
    </li>
  );
}

export function EngineeringChangeRows({
  workspace,
  observedAt,
  pending,
  revise,
  run,
}: {
  workspace: EngineeringChangeWorkspace;
  observedAt: number;
  pending: boolean;
  revise: (change: EngineeringChange) => void;
  run: RunEngineeringChange;
}) {
  const t = engineeringMessages[useLocalePreferences().locale];
  return workspace.changes.length === 0 ? (
    <p className="text-xs text-muted-foreground">{t.empty}</p>
  ) : (
    <ul className="space-y-2">
      {workspace.changes.map((change) => {
        const effective = workspace.effectiveRelease?.id === change.review.candidate.id;
        const scheduled = !effective && Date.parse(change.effectiveAt) > observedAt;
        const status =
          change.status === "approved"
            ? effective
              ? "effective"
              : scheduled
                ? "scheduled"
                : "approved"
            : change.status;
        return (
          <ChangeRow
            key={change.id}
            {...{ change, status, pending, revise, run, t }}
            canPropose={workspace.canPropose}
            canDecide={workspace.canDecide}
          />
        );
      })}
    </ul>
  );
}

function PositionFacts({ position, t }: { position: OldReleasePosition; t: EngineeringLabels }) {
  const facts: { label: string; value: ReactNode }[] = [
    { label: t.site, value: position.site },
    { label: t.location, value: position.location },
    { label: t.lot, value: position.lot },
    { label: t.serial, value: position.serial },
    { label: t.quantity, value: position.quantity },
    { label: t.reserved, value: position.reserved },
  ];
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
      {facts.map(({ label, value }) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xs wrap-anywhere">
            <bdi>{value ?? t.missing}</bdi>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StockPosition({
  position,
  pending,
  run,
  t,
}: {
  position: OldReleasePosition;
  pending: boolean;
  run: RunEngineeringChange;
  t: EngineeringLabels;
}) {
  const action = position.status === "held" ? "release" : "hold";
  return (
    <li
      data-engineering-position={position.id}
      data-engineering-position-status={position.status}
      className="min-w-0 space-y-3 rounded-md border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
        <bdi>{position.revision}</bdi>
        <Badge variant="outline">{t[position.status]}</Badge>
      </div>
      <PositionFacts {...{ position, t }} />
      <History
        stock
        title={t.stockHistory}
        entries={position.history.map(({ action: change, reason, ...rest }) => ({
          ...rest,
          label: t[change],
          note: reason,
        }))}
      />
      {position.canDispose && position.status !== "unavailable" && (
        <ReasonForm
          label={t.stockReason}
          action={t[action]}
          pending={pending}
          kind={action}
          submit={(reason) =>
            run({
              type: "disposition",
              changeId: position.changeId,
              positionId: position.id,
              expectedPositionVersion: position.version,
              action,
              reason,
            })
          }
        />
      )}
    </li>
  );
}

export function EngineeringStock({
  stock,
  pending,
  run,
}: {
  stock: NonNullable<EngineeringChangeWorkspace["stock"]>;
  pending: boolean;
  run: RunEngineeringChange;
}) {
  const t = engineeringMessages[useLocalePreferences().locale];
  return (
    <section aria-label={t.stock} className="space-y-2 border-t pt-3">
      <h5 className="text-sm font-semibold">{t.stock}</h5>
      {stock.unattributed && <p className="text-xs text-muted-foreground">{t.unattributed}</p>}
      {stock.positions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t.noPositions}</p>
      ) : (
        <ul className="space-y-2">
          {stock.positions.map((position) => (
            <StockPosition key={position.id} {...{ position, pending, run, t }} />
          ))}
        </ul>
      )}
    </section>
  );
}
