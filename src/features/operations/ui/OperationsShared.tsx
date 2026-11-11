"use client";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences, useMessages } from "@/features/i18n/LocaleProvider";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { OPERATIONS_CURSOR_HISTORY_LIMIT, type useOperationsCursor } from "./viewState";

export function useOperationsLabels() {
  return useMessages().operations;
}
export type OperationsLabels = ReturnType<typeof useOperationsLabels>;

export function OperationsCode({ children }: { children: ReactNode }) {
  return (
    <code dir="ltr" className="break-all text-xs">
      {children}
    </code>
  );
}
export function OperationsMetric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}
export function useOperationsFormat() {
  const preferences = useLocalePreferences();
  const L = useOperationsLabels();
  return {
    number: (value: number | null) =>
      value === null ? L.unknownValue : formatNumber(value, preferences),
    seconds: (value: number | null) =>
      value === null
        ? L.unknownValue
        : formatNumber(value / 1000, preferences, { maximumFractionDigits: 0 }),
    date: (value: string | number | null) =>
      value === null ? L.unknownValue : formatDateTime(value, preferences) || L.unknownValue,
  };
}
export function operationsReason(reason: string, L: OperationsLabels): string {
  const reasons: Record<string, string> = L.reasons;
  return reasons[reason] ?? L.unknownReason;
}

export function operationsSourceLabel(state: string, L: OperationsLabels): string {
  switch (state) {
    case "active":
      return L.sourceState.active;
    case "inactive":
      return L.sourceState.inactive;
    case "storage_pressure":
      return L.sourceState.storage_pressure;
    case "retired_generation":
      return L.sourceState.retired_generation;
    default:
      return L.unknownValue;
  }
}

export function OperationsReadNotice({
  denied,
  failure,
  busy,
  empty,
}: {
  denied: boolean;
  failure: string | null;
  busy: boolean;
  empty: boolean;
}) {
  const L = useOperationsLabels();
  if (denied)
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {L.denied}
      </p>
    );
  return (
    <>
      {failure !== null && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {L.unavailable}
        </p>
      )}
      {busy && (empty || failure !== null) && (
        <p role="status" className="text-sm text-muted-foreground">
          {failure !== null ? L.pendingRead : L.loading}
        </p>
      )}
    </>
  );
}

export function OperationsPager<Cursor>({
  pager,
  next,
  busy,
}: {
  pager: ReturnType<typeof useOperationsCursor<Cursor>>;
  next: Cursor | null | undefined;
  busy: boolean;
}) {
  const L = useOperationsLabels();
  const format = useOperationsFormat();
  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <p className="text-xs text-muted-foreground">
        {L.page} {format.number(pager.page)} · {L.pageScope}
      </p>
      {pager.page >= OPERATIONS_CURSOR_HISTORY_LIMIT && next !== null && next !== undefined && (
        <p role="status" className="text-sm">
          {L.pageLimit}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || pager.page === 1}
          onClick={pager.first}
        >
          {L.first}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || pager.page === 1}
          onClick={pager.previous}
        >
          {L.previous}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !pager.canNext(next)}
          onClick={() => pager.next(next)}
        >
          {L.next}
        </Button>
      </div>
    </div>
  );
}
