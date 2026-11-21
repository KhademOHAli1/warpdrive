"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  CommissionStockButton,
  type OpenCommissionStock,
} from "@/features/assets/commissioning/ui/CommissionStockPanel";
import { useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import type {
  WarehouseBalance,
  WarehouseIncoming,
  WarehousePosition,
  WarehouseWorkspace,
} from "../contracts";
import { warehouseLocationLabel, warehousePartLabel } from "./warehouseDisplay";
import { type WarehouseWords, warehouseMessages } from "./warehouseMessages";

function WarehouseTable({
  label,
  columns,
  empty,
  children,
  isEmpty,
}: {
  label: string;
  columns: string[];
  empty: string;
  children: ReactNode;
  isEmpty: boolean;
}) {
  if (isEmpty)
    return <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table aria-label={label} className="w-full text-sm">
        <thead className="border-b bg-muted/30">
          <tr>
            {columns.map((column) => (
              <th
                className="whitespace-nowrap px-3 py-2 text-start text-xs font-medium text-muted-foreground"
                scope="col"
                key={column}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}

function ItemLocation({
  itemId,
  locationId,
  workspace,
  t,
}: {
  itemId: string;
  locationId: string | null;
  workspace: WarehouseWorkspace;
  t: WarehouseWords;
}) {
  const part = workspace.parts.find(({ id }) => id === itemId);
  const location = workspace.locations.find(({ id }) => id === locationId);
  return (
    <td className="min-w-44 px-3 py-2.5">
      {part !== undefined && (
        <p className="break-words font-medium">
          <bdi>{warehousePartLabel(part)}</bdi>
        </p>
      )}
      <p className="break-words text-xs text-muted-foreground">
        <bdi>
          {location === undefined ? t.unlocated : warehouseLocationLabel(location, workspace)}
        </bdi>
      </p>
      {location !== undefined && location.kind !== "storage" && (
        <Badge variant="outline" className="mt-1">
          {t[location.kind]}
        </Badge>
      )}
    </td>
  );
}

function useWarehouseNumbers() {
  const locale = useLocale();
  const numbering = useNumberingSystem();
  return new Intl.NumberFormat(locale, { numberingSystem: numbering });
}

function Count({ count, numbers }: { count: number; numbers: Intl.NumberFormat }) {
  return <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{numbers.format(count)}</td>;
}

export function WarehouseBalancesTable({
  rows,
  workspace,
  t,
}: {
  rows: WarehouseBalance[];
  workspace: WarehouseWorkspace;
  t: WarehouseWords;
}) {
  const numbers = useWarehouseNumbers();
  return (
    <WarehouseTable
      label={t.balances}
      columns={[t.part, t.onHand, t.reserved, t.available, t.incoming]}
      empty={t.noBalances}
      isEmpty={rows.length === 0}
    >
      {rows.map((row) => (
        <tr
          key={`${row.itemId}:${row.siteId ?? ""}:${row.locationId ?? ""}`}
          data-warehouse-location-id={row.locationId ?? ""}
        >
          <ItemLocation
            itemId={row.itemId}
            locationId={row.locationId}
            workspace={workspace}
            t={t}
          />
          <Count count={row.onHand} numbers={numbers} />
          <Count count={row.reserved} numbers={numbers} />
          <Count count={row.available} numbers={numbers} />
          <Count count={row.incoming} numbers={numbers} />
        </tr>
      ))}
    </WarehouseTable>
  );
}

function WarehouseOwner({
  ownerId,
  owned,
  workspace,
  t,
}: {
  ownerId: string | null;
  owned: boolean;
  workspace: WarehouseWorkspace;
  t: WarehouseWords;
}) {
  if (!owned) return <span className="text-xs text-muted-foreground">{t.warehouseOwned}</span>;
  const owner = workspace.organizations.find(({ id }) => id === ownerId);
  return (
    <span className="break-words text-xs text-muted-foreground">
      <bdi>{owner?.name ?? t.owned}</bdi>
    </span>
  );
}

export function WarehousePositionsTable({
  rows,
  workspace,
  busy,
  changeState,
  commissioning,
}: {
  rows: WarehousePosition[];
  workspace: WarehouseWorkspace;
  busy: boolean;
  changeState: (trigger: HTMLButtonElement, position: WarehousePosition) => void;
  commissioning?: { siteIds: readonly string[]; open: OpenCommissionStock } | undefined;
}) {
  const numbers = useWarehouseNumbers();
  const t = warehouseMessages[useLocale()];
  const today = new Date().toISOString().slice(0, 10);
  const manage = workspace.sites.some(({ canManage }) => canManage);
  const actionHeader = manage ? [t.warehouseActions] : [];
  return (
    <WarehouseTable
      label={t.positions}
      columns={[
        t.part,
        t.lot,
        t.serial,
        t.expiryDate,
        t.state,
        t.onHand,
        t.reserved,
        t.available,
        ...actionHeader,
      ]}
      empty={t.noPositions}
      isEmpty={rows.length === 0}
    >
      {rows.map((row) => {
        const location = workspace.locations.find(({ id }) => id === row.locationId);
        const site = workspace.sites.find(({ id }) => id === row.siteId);
        const canChange =
          site?.canManage === true &&
          !site.archived &&
          location?.archived === false &&
          row.onHand > row.reserved;
        return (
          <tr key={row.id} data-warehouse-position-id={row.id}>
            <ItemLocation
              itemId={row.itemId}
              locationId={row.locationId}
              workspace={workspace}
              t={t}
            />
            <td className="min-w-20 px-3 py-2.5">
              <bdi dir="ltr">{row.lot ?? "—"}</bdi>
            </td>
            <td className="min-w-20 px-3 py-2.5">
              <bdi dir="ltr">{row.serial ?? "—"}</bdi>
            </td>
            <td className="whitespace-nowrap px-3 py-2.5">
              <bdi dir="ltr">{row.expiryDate ?? "—"}</bdi>
              {row.expiryDate !== null && row.expiryDate < today && (
                <p className="text-xs text-destructive">{t.expired}</p>
              )}
            </td>
            <td className="min-w-24 px-3 py-2.5">
              <div className="grid gap-1">
                <Badge variant={row.state === "available" ? "outline" : "secondary"}>
                  {t[row.state]}
                </Badge>
                <WarehouseOwner
                  ownerId={row.ownerOrganizationId}
                  owned={row.owned}
                  workspace={workspace}
                  t={t}
                />
              </div>
            </td>
            <Count count={row.onHand} numbers={numbers} />
            <Count count={row.reserved} numbers={numbers} />
            <Count count={row.available} numbers={numbers} />
            {manage && (
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {canChange && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={(event) => changeState(event.currentTarget, row)}
                    >
                      {t.changeState}
                    </Button>
                  )}
                  {commissioning !== undefined && (
                    <CommissionStockButton
                      workspace={workspace}
                      position={row}
                      busy={busy}
                      siteIds={commissioning.siteIds}
                      open={commissioning.open}
                    />
                  )}
                </div>
              </td>
            )}
          </tr>
        );
      })}
    </WarehouseTable>
  );
}

export function WarehouseIncomingTable({
  rows,
  workspace,
  busy,
  receive,
  cancel,
}: {
  rows: WarehouseIncoming[];
  workspace: WarehouseWorkspace;
  busy: boolean;
  receive: (trigger: HTMLButtonElement, row: WarehouseIncoming) => void;
  cancel: (id: string) => void;
}) {
  const numbers = useWarehouseNumbers();
  const t = warehouseMessages[useLocale()];
  const manage = workspace.sites.some(({ canManage }) => canManage);
  const actionHeader = manage ? [t.warehouseActions] : [];
  return (
    <WarehouseTable
      label={t.incomingStock}
      columns={[
        t.part,
        t.reference,
        t.expectedDate,
        t.quantity,
        t.received,
        t.remaining,
        ...actionHeader,
      ]}
      empty={t.noIncoming}
      isEmpty={rows.length === 0}
    >
      {rows.map((row) => {
        const outstanding = row.quantity - row.received;
        const canManage = workspace.sites.find(({ id }) => id === row.siteId)?.canManage === true;
        const location = workspace.locations.find(({ id }) => id === row.locationId);
        const part = workspace.parts.find(({ id }) => id === row.itemId);
        const open = !row.purchaseOwned && canManage && !row.cancelled && outstanding > 0;
        const canReceive =
          open &&
          location?.archived === false &&
          location.kind !== "structure" &&
          part?.canReceive === true &&
          (!row.owned || row.ownerOrganizationId !== null);
        return (
          <tr key={row.id} data-warehouse-incoming-id={row.id}>
            <ItemLocation
              itemId={row.itemId}
              locationId={row.locationId}
              workspace={workspace}
              t={t}
            />
            <td className="min-w-24 px-3 py-2.5">
              <p>
                {row.purchaseOrderId === null ? (
                  <bdi>{row.reference ?? "—"}</bdi>
                ) : (
                  <Link
                    href={{
                      pathname: "/inventory/purchase-orders",
                      query: { siteId: row.siteId, orderId: row.purchaseOrderId },
                    }}
                    prefetch={false}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    <bdi>{row.reference ?? t.purchaseOrder}</bdi>
                  </Link>
                )}
              </p>
              {row.purchaseOwned && (
                <Badge variant="outline" className="mt-1">
                  {t.purchaseOrder}
                </Badge>
              )}
              <WarehouseOwner
                ownerId={row.ownerOrganizationId}
                owned={row.owned}
                workspace={workspace}
                t={t}
              />
            </td>
            <td className="whitespace-nowrap px-3 py-2.5">
              <bdi dir="ltr">{row.expectedDate ?? "—"}</bdi>
            </td>
            <Count count={row.quantity} numbers={numbers} />
            <Count count={row.received} numbers={numbers} />
            <td className="px-3 py-2.5 tabular-nums">
              {row.cancelled ? (
                <Badge variant="secondary">{t.canceled}</Badge>
              ) : outstanding === 0 ? (
                <Badge variant="outline">{t.complete}</Badge>
              ) : (
                numbers.format(outstanding)
              )}
            </td>
            {manage && (
              <td className="px-3 py-2.5">
                {open && (
                  <div className="flex flex-wrap gap-2">
                    {canReceive && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={(event) => receive(event.currentTarget, row)}
                      >
                        {t.receivePlan}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => cancel(row.id)}
                    >
                      {t.cancelIncoming}
                    </Button>
                  </div>
                )}
              </td>
            )}
          </tr>
        );
      })}
    </WarehouseTable>
  );
}
