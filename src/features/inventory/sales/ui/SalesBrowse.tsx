"use client";

import { CalendarDays, List, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type { SalesOrderSummary, SalesQuery, SalesWorkspace } from "../contracts";
import { useSalesDisplay } from "./display";
import type { SalesMessages } from "./messages";
import { SalesCalendar } from "./SalesCalendar";
import {
  displayStatus,
  isOverdue,
  type OpenSalesEditor,
  type SalesView,
  salesOrderHref,
} from "./types";

const statuses = ["draft", "issued", "partial", "shipped", "cancelled"] as const;
const headingCell = "px-3 py-2 text-start text-xs font-medium text-muted-foreground";
const rowCell = "px-3 py-2.5 align-top text-sm";

export function SalesStatus({ order, t }: { order: SalesOrderSummary; t: SalesMessages }) {
  const status = displayStatus(order);
  return <Badge variant={status === "shipped" ? "success" : "outline"}>{t[status]}</Badge>;
}

function OrderTable({
  orders,
  today,
  sites,
  selectedId,
  orderHref,
  t,
}: {
  orders: SalesOrderSummary[];
  today: string;
  sites: SalesWorkspace["sites"];
  selectedId: string | undefined;
  orderHref: (id: string) => string;
  t: SalesMessages;
}) {
  const f = useSalesDisplay();
  const columns = [t.reference, t.site, t.due, t.status, t.shipped, t.backorder];
  const siteNames = new Map(sites.map(({ id, name }) => [id, name]));
  if (orders.length === 0) return <p className="p-4 text-sm text-muted-foreground">{t.noOrders}</p>;
  return (
    <div className="overflow-x-auto" data-sales-list>
      <table aria-label={t.orders} className="w-full min-w-[39rem]">
        <thead className="bg-muted/25">
          <tr>
            {columns.map((title) => (
              <th key={title} scope="col" className={headingCell}>
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {orders.map((order) => (
            <tr
              key={order.id}
              data-sales-order-id={order.id}
              data-sales-order-status={order.status}
              data-selected={order.id === selectedId}
              className="data-[selected=true]:bg-muted/50"
            >
              <th scope="row" className={`${rowCell} text-start font-medium`}>
                <Link
                  href={orderHref(order.id)}
                  aria-current={order.id === selectedId ? "page" : undefined}
                  className="text-primary hover:underline"
                  prefetch={false}
                >
                  <bdi className="break-words">{order.reference}</bdi>
                </Link>
                {order.customerName !== null && (
                  <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                    <bdi>{order.customerName}</bdi>
                  </p>
                )}
              </th>
              <td className={rowCell}>
                <bdi>{siteNames.get(order.siteId) ?? "—"}</bdi>
              </td>
              <td className={rowCell}>
                {order.dueDate === null ? (
                  "—"
                ) : (
                  <time dateTime={order.dueDate}>{f.date(order.dueDate)}</time>
                )}
                {isOverdue(order, today) && (
                  <p className="mt-0.5 text-xs text-destructive">{t.overdue}</p>
                )}
              </td>
              <td className={rowCell}>
                <SalesStatus {...{ order, t }} />
              </td>
              <td className={`${rowCell} whitespace-nowrap tabular-nums`}>
                <bdi>
                  {f.quantity(order.shipped)} / {f.quantity(order.ordered)}
                </bdi>
              </td>
              <td
                className={`${rowCell} tabular-nums`}
                data-sales-order-backordered={order.backordered}
              >
                {f.quantity(order.backordered)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalesBrowse({
  workspace,
  scope,
  view,
  day,
  busy,
  open,
  navigate,
  t,
}: {
  workspace: SalesWorkspace;
  scope: SalesQuery;
  view: SalesView;
  day: string | undefined;
  busy: boolean;
  open: OpenSalesEditor;
  navigate: (query: SalesQuery, view: SalesView, day?: string) => void;
  t: SalesMessages;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const names = new Map(workspace.sites.map(({ id, name }) => [id, name]));
  const anchor = day ?? workspace.detail?.dueDate ?? workspace.today;
  const normalized = search.trim().toLowerCase();
  const orders = workspace.orders.filter((order) => {
    if (status !== "" && displayStatus(order) !== status) return false;
    return (
      normalized === "" ||
      [order.reference, order.customerName, names.get(order.siteId)].some(
        (value) => value?.toLowerCase().includes(normalized) === true,
      )
    );
  });
  const orderHref = (orderId: string) => salesOrderHref({ ...scope, orderId }, view, anchor);

  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-label={t.orders}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b p-3">
        <div className="grid min-w-0 flex-1 gap-2 sm:max-w-3xl sm:grid-cols-[minmax(9rem,1.1fr)_minmax(9rem,1.3fr)_minmax(8rem,0.85fr)]">
          <CatalogField label={t.site}>
            <CatalogSelect
              ariaLabel={t.site}
              value={scope.siteId ?? ""}
              options={[
                { value: "", label: t.allSites },
                ...workspace.sites.map(({ id, name, code, archived }) => ({
                  value: id,
                  label:
                    archived === true
                      ? `${name} · ${code} (${t.siteArchived})`
                      : `${name} · ${code}`,
                })),
              ]}
              disabled={busy}
              onChange={(siteId) =>
                navigate(
                  { dealId: scope.dealId, siteId: siteId === "" ? undefined : siteId },
                  view,
                  anchor,
                )
              }
            />
          </CatalogField>
          <CatalogField label={t.search} id="sales-order-search">
            <Input
              id="sales-order-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-9"
            />
          </CatalogField>
          <CatalogField label={t.status}>
            <CatalogSelect
              ariaLabel={t.status}
              value={status}
              options={[
                { value: "", label: t.allStatuses },
                ...statuses.map((value) => ({ value, label: t[value] })),
              ]}
              onChange={setStatus}
            />
          </CatalogField>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded-md border bg-muted/35 p-0.5">
            <Button
              type="button"
              size="sm"
              variant={view === "list" ? "outline" : "ghost"}
              aria-pressed={view === "list"}
              disabled={busy}
              onClick={() => navigate(scope, "list")}
            >
              <List aria-hidden="true" className="size-4" />
              {t.list}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "calendar" ? "outline" : "ghost"}
              aria-pressed={view === "calendar"}
              disabled={busy}
              onClick={() => navigate(scope, "calendar", anchor)}
            >
              <CalendarDays aria-hidden="true" className="size-4" />
              {t.calendar}
            </Button>
          </div>
          {workspace.deal?.canOrder === true &&
            workspace.sites.some(({ archived }) => archived !== true) && (
              <Button
                type="button"
                size="sm"
                data-sales-action="saveDraft"
                disabled={busy}
                onClick={(event) => open(event, { type: "saveDraft", order: null })}
              >
                <Plus aria-hidden="true" className="size-4" />
                {t.newOrder}
              </Button>
            )}
        </div>
      </div>
      {view === "calendar" ? (
        <SalesCalendar
          orders={orders}
          anchorDay={anchor}
          today={workspace.today}
          selectedId={scope.orderId}
          busy={busy}
          t={t}
          orderHref={orderHref}
          changeDay={(next) => navigate(scope, "calendar", next)}
        />
      ) : (
        <OrderTable
          orders={orders}
          today={workspace.today}
          sites={workspace.sites}
          selectedId={scope.orderId}
          orderHref={orderHref}
          t={t}
        />
      )}
    </section>
  );
}
