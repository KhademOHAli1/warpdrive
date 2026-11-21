"use client";

import { type MouseEvent, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { trpc } from "@/lib/trpc-client";
import type { WarehouseWorkspace } from "../../contracts";
import { warehouseMessages } from "../../ui/warehouseMessages";
import type {
  WarehouseMovementCursor,
  WarehouseMovementRow,
  WarehouseTransferCursor,
  WarehouseTransferRow,
} from "../readContracts";
import { displayMovementKind, isTransferStatus } from "./display";
import type { OperationsEditor } from "./OperationsDialogs";
import {
  defaultOperationsFilter,
  type OperationsFilter,
  OperationsFilters,
  type OperationsTab,
} from "./OperationsFilters";
import { type OperationsWords, operationsMessages } from "./operationsMessages";

type OpenEditor = (event: MouseEvent<HTMLButtonElement>, editor: OperationsEditor) => void;

const dateFormat = { dateStyle: "medium", timeStyle: "short" } as const;

function OperationReference({ id }: { id: string }) {
  return (
    <bdi dir="ltr" className="break-all font-mono text-xs">
      {id}
    </bdi>
  );
}

function useOperationList<Cursor>(tab: OperationsTab) {
  const [filter, setFilter] = useState(() => defaultOperationsFilter(tab));
  const [cursor, setCursor] = useState<Cursor | undefined>();
  function change(next: OperationsFilter) {
    setCursor(undefined);
    setFilter(next);
  }
  const common = {
    limit: 30,
    search: filter.search.trim() || undefined,
    itemId: filter.itemId || undefined,
    siteId: filter.siteId || undefined,
    locationId: filter.locationId || undefined,
    cursor,
  };
  return { filter, change, common, cursor, setCursor };
}

function PageControls({
  hasOlder,
  hasNewer,
  older,
  latest,
  t,
}: {
  hasOlder: boolean;
  hasNewer: boolean;
  older: () => void;
  latest: () => void;
  t: OperationsWords;
}) {
  if (!hasOlder && !hasNewer) return null;
  return (
    <nav aria-label={t.pageNavigation} className="flex justify-end gap-2">
      {hasNewer && (
        <Button size="sm" variant="outline" onClick={latest}>
          {t.first}
        </Button>
      )}
      {hasOlder && (
        <Button size="sm" variant="outline" onClick={older}>
          {t.next}
        </Button>
      )}
    </nav>
  );
}

function TransferCard({
  transfer,
  dates,
  numbers,
  t,
  open,
  busy,
}: {
  transfer: WarehouseTransferRow;
  dates: Intl.DateTimeFormat;
  numbers: Intl.NumberFormat;
  t: OperationsWords;
  open: OpenEditor;
  busy: boolean;
}) {
  return (
    <article
      data-warehouse-transfer-id={transfer.id}
      className="space-y-3 rounded-lg border bg-card p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">
              {t.transferReference} <OperationReference id={transfer.id} />
            </h2>
            <Badge variant="outline">{t[transfer.status]}</Badge>
          </div>
          <p className="break-words text-sm text-muted-foreground">
            <bdi>
              {transfer.sourceSiteName} / {transfer.sourceLocationName}
            </bdi>
            <span aria-hidden="true"> → </span>
            <bdi>
              {transfer.destinationSiteName} / {transfer.destinationLocationName}
            </bdi>
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          <time dateTime={transfer.updatedAt}>{dates.format(new Date(transfer.updatedAt))}</time>
          {transfer.actorName !== null && (
            <>
              {" "}
              · <bdi>{transfer.actorName}</bdi>
            </>
          )}
        </p>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">
        <bdi>{transfer.reason}</bdi>
      </p>
      <ul className="divide-y rounded-md border">
        {transfer.lines.map((line) => (
          <li
            key={line.id}
            className="flex flex-wrap items-start justify-between gap-2 p-2.5 text-sm"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">
                <bdi>
                  {line.code} · {line.revision} — {line.name}
                </bdi>
              </p>
              {(line.lot !== null || line.serial !== null) && (
                <p className="break-words text-muted-foreground">
                  {line.lot !== null && (
                    <>
                      {t.lot} <bdi>{line.lot}</bdi>
                    </>
                  )}
                  {line.lot !== null && line.serial !== null && <> · </>}
                  {line.serial !== null && (
                    <>
                      {t.serial} <bdi>{line.serial}</bdi>
                    </>
                  )}
                </p>
              )}
            </div>
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-end">
              <div>
                <dt className="text-muted-foreground">{t.ordered}</dt>
                <dd className="font-medium tabular-nums">{numbers.format(line.quantity)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t.received}</dt>
                <dd className="font-medium tabular-nums">{numbers.format(line.received)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t.remaining}</dt>
                <dd className="font-medium tabular-nums">
                  {numbers.format(line.quantity - line.received)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      {transfer.canManage && (transfer.status === "draft" || transfer.status === "in_transit") && (
        <div className="flex flex-wrap justify-end gap-2">
          {transfer.status === "draft" ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={(event) => open(event, { type: "cancelTransfer", transfer })}
              >
                {t.cancelTransfer}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={(event) => open(event, { type: "dispatchTransfer", transfer })}
              >
                {t.dispatch}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy}
              onClick={(event) => open(event, { type: "receiveTransfer", transfer })}
            >
              {t.receive}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

export function TransfersView({
  workspace,
  open,
  busy,
}: {
  workspace: WarehouseWorkspace;
  open: OpenEditor;
  busy: boolean;
}) {
  const preferences = useLocalePreferences();
  const t = operationsMessages[preferences.locale];
  const tag = localeTagForFormatting(preferences);
  const dates = new Intl.DateTimeFormat(tag, { ...dateFormat, timeZone: preferences.timeZone });
  const numbers = new Intl.NumberFormat(tag);
  const { filter, change, common, cursor, setCursor } =
    useOperationList<WarehouseTransferCursor>("transfers");
  const query = trpc.inventory.warehouse.transfers.useQuery(
    { ...common, status: isTransferStatus(filter.status) ? filter.status : undefined },
    { gcTime: 0, retry: false, refetchOnWindowFocus: false },
  );
  const result = query.data;
  const page = result?.ok === true ? result.value : null;
  const failed = query.isError || result?.ok === false;

  return (
    <div className="space-y-3">
      <OperationsFilters tab="transfers" workspace={workspace} change={change} />
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t.unavailable}
        </p>
      )}
      {page !== null && page.rows.length === 0 && (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t.noTransfers}
        </p>
      )}
      {page?.rows.map((transfer) => (
        <TransferCard
          key={transfer.id}
          transfer={transfer}
          dates={dates}
          numbers={numbers}
          t={t}
          open={open}
          busy={busy}
        />
      ))}
      <PageControls
        hasNewer={cursor !== undefined}
        hasOlder={page?.nextCursor != null}
        latest={() => setCursor(undefined)}
        older={() => setCursor(page?.nextCursor ?? undefined)}
        t={t}
      />
    </div>
  );
}

function HistoryReferences({
  movement,
  t,
}: {
  movement: WarehouseMovementRow;
  t: OperationsWords;
}) {
  const links = [
    { value: movement.transferId, label: t.transferReference },
    { value: movement.orderId, label: t.orderReference },
    { value: movement.incomingId, label: t.incoming },
    { value: movement.reversesEventId, label: t.reversedMovement },
  ];
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {links.flatMap(({ value, label }) =>
        value === null ? (
          []
        ) : (
          <li key={label}>
            {label} <OperationReference id={value} />
          </li>
        ),
      )}
    </ul>
  );
}

function HistoryRow({
  movement,
  workspace,
  numbers,
  deltas,
  dates,
  open,
  busy,
}: {
  movement: WarehouseMovementRow;
  workspace: WarehouseWorkspace;
  numbers: Intl.NumberFormat;
  deltas: Intl.NumberFormat;
  dates: Intl.DateTimeFormat;
  open: OpenEditor;
  busy: boolean;
}) {
  const { locale } = useLocalePreferences();
  const t = operationsMessages[locale];
  const ware = warehouseMessages[locale];
  const position = movement.canReverse
    ? workspace.positions.find(({ id }) => id === movement.positionId)
    : undefined;
  const changes = [
    { value: movement.onHandDelta, label: t.onHand },
    { value: movement.reservedDelta, label: t.reserved },
    { value: movement.incomingDelta, label: t.incoming },
  ];
  return (
    <tr data-warehouse-movement-id={movement.id} className="border-b align-top last:border-b-0">
      <td className="whitespace-nowrap p-2.5">
        <time dateTime={movement.createdAt}>{dates.format(new Date(movement.createdAt))}</time>
        {movement.actorName !== null && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            <bdi>{movement.actorName}</bdi>
          </p>
        )}
      </td>
      <td className="min-w-40 p-2.5">
        <p className="font-medium">
          <bdi>
            {movement.code} · {movement.revision}
          </bdi>
        </p>
        <p className="text-muted-foreground">
          <bdi>{movement.name}</bdi>
        </p>
        {movement.lot !== null && (
          <p className="text-xs">
            {t.lot} <bdi>{movement.lot}</bdi>
          </p>
        )}
        {movement.serial !== null && (
          <p className="text-xs">
            {t.serial} <bdi>{movement.serial}</bdi>
          </p>
        )}
      </td>
      <td className="min-w-32 p-2.5">
        <bdi>
          {[movement.siteName, movement.locationName].filter((name) => name !== null).join(" / ") ||
            t.unlocated}
        </bdi>
      </td>
      <td className="min-w-40 p-2.5">
        <p className="font-medium">{displayMovementKind(movement.kind, locale)}</p>
        {changes
          .filter(({ value }) => value !== 0)
          .map(({ value, label }) => (
            <p key={label} className="text-xs text-muted-foreground">
              {label}{" "}
              <bdi dir="ltr" className="font-medium tabular-nums">
                {deltas.format(value)}
              </bdi>
            </p>
          ))}
        {movement.affectedQuantity !== null && movement.onHandDelta === 0 && (
          <p className="text-xs text-muted-foreground">
            {t.quantity} <bdi>{numbers.format(movement.affectedQuantity)}</bdi>
          </p>
        )}
        {movement.previousOnHand !== null && (
          <p className="text-xs text-muted-foreground">
            {t.onHand}{" "}
            <bdi dir="ltr" className="tabular-nums">
              {numbers.format(movement.previousOnHand)} →{" "}
              {numbers.format(movement.previousOnHand + movement.onHandDelta)}
            </bdi>
          </p>
        )}
        {movement.previousState !== null && movement.state !== null && (
          <p className="text-xs text-muted-foreground">
            {ware[movement.previousState]} → {ware[movement.state]}
          </p>
        )}
      </td>
      <td className="min-w-44 p-2.5">
        {movement.reason !== null && (
          <p className="whitespace-pre-wrap break-words">
            <bdi>{movement.reason}</bdi>
          </p>
        )}
        <HistoryReferences movement={movement} t={t} />
      </td>
      <td className="p-2.5 text-end">
        {position !== undefined && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={(event) => open(event, { type: "reverseCorrection", movement, position })}
          >
            {t.reverseCorrection}
          </Button>
        )}
      </td>
    </tr>
  );
}

export function HistoryView({
  workspace,
  open,
  busy,
  corrections = false,
}: {
  workspace: WarehouseWorkspace;
  open: OpenEditor;
  busy: boolean;
  corrections?: boolean;
}) {
  const preferences = useLocalePreferences();
  const t = operationsMessages[preferences.locale];
  const tag = localeTagForFormatting(preferences);
  const dates = new Intl.DateTimeFormat(tag, { ...dateFormat, timeZone: preferences.timeZone });
  const numbers = new Intl.NumberFormat(tag);
  const deltas = new Intl.NumberFormat(tag, { signDisplay: "exceptZero" });
  const tab = corrections ? "corrections" : "history";
  const { filter, change, common, cursor, setCursor } =
    useOperationList<WarehouseMovementCursor>(tab);
  const query = trpc.inventory.warehouse.history.useQuery(
    {
      ...common,
      kind: filter.kind || undefined,
      from: filter.from || undefined,
      to: filter.to || undefined,
    },
    { gcTime: 0, retry: false, refetchOnWindowFocus: false },
  );
  const result = query.data;
  const page = result?.ok === true ? result.value : null;
  const failed = query.isError || result?.ok === false;

  return (
    <div className="space-y-3">
      <OperationsFilters tab={tab} workspace={workspace} change={change} />
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.loading}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t.unavailable}
        </p>
      )}
      {page !== null && page.rows.length === 0 && (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t.noHistory}</p>
      )}
      {page !== null && page.rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[58rem] text-start text-sm" aria-label={t[tab]}>
            <thead className="border-b bg-muted/30 text-muted-foreground">
              <tr>
                {[t.when, t.part, t.location, t.change, t.reference, t.actions].map((label) => (
                  <th key={label} scope="col" className="p-2.5 text-start font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((movement) => (
                <HistoryRow
                  key={`${movement.source}:${movement.id}`}
                  movement={movement}
                  workspace={workspace}
                  numbers={numbers}
                  deltas={deltas}
                  dates={dates}
                  open={open}
                  busy={busy}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PageControls
        hasNewer={cursor !== undefined}
        hasOlder={page?.nextCursor != null}
        latest={() => setCursor(undefined)}
        older={() => setCursor(page?.nextCursor ?? undefined)}
        t={t}
      />
    </div>
  );
}
