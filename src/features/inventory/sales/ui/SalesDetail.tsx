"use client";

import { ClipboardList, ExternalLink, PackageCheck } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { SalesOrderDetail, SalesOrderLine, SalesShipment, SalesWorkspace } from "../contracts";
import { orderTotal, useSalesDisplay } from "./display";
import type { SalesMessages } from "./messages";
import { SalesStatus } from "./SalesBrowse";
import { SalesPackingSlip } from "./SalesPackingSlip";
import type { OpenSalesEditor } from "./types";

const columnClass = "px-3 py-2 text-start text-xs font-medium text-muted-foreground";
const cellClass = "px-3 py-2 align-top text-sm";

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="mb-0.5 text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{children}</dd>
    </div>
  );
}

function StockDetails({
  location,
  lot,
  serial,
  t,
}: {
  location: string;
  lot: string | null;
  serial: string | null;
  t: SalesMessages;
}) {
  return (
    <dl className="flex flex-wrap items-start gap-x-3 gap-y-1.5 text-xs">
      <div>
        <dt className="me-1 inline text-muted-foreground">{t.bin}</dt>
        <dd className="inline">
          <bdi>{location}</bdi>
        </dd>
      </div>
      {lot !== null && (
        <div>
          <dt className="me-1 inline text-muted-foreground">{t.lot}</dt>
          <dd className="inline">
            <bdi>{lot}</bdi>
          </dd>
        </div>
      )}
      {serial !== null && (
        <div>
          <dt className="me-1 inline text-muted-foreground">{t.serial}</dt>
          <dd className="inline">
            <bdi>{serial}</bdi>
          </dd>
        </div>
      )}
    </dl>
  );
}

function OrderToolbar({
  order,
  open,
  busy,
  t,
}: {
  order: SalesOrderDetail;
  open: OpenSalesEditor;
  busy: boolean;
  t: SalesMessages;
}) {
  const draft = order.status === "draft";
  const openOrder = order.status === "issued";
  const hasFreeAllocation = order.lines.some((line) =>
    line.allocations.some(({ committed, quantity }) => quantity > committed),
  );
  const canCancel = order.canCancel ?? order.canEdit;
  return (
    <div className="flex flex-wrap gap-2 empty:hidden">
      {draft && order.canEdit && (
        <>
          <Button
            type="button"
            size="sm"
            data-sales-action="issueOrder"
            disabled={busy}
            onClick={(event) => open(event, { type: "issueOrder", order })}
          >
            {t.issue}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-sales-action="saveDraft"
            disabled={busy}
            onClick={(event) => open(event, { type: "saveDraft", order })}
          >
            {t.editOrder}
          </Button>
        </>
      )}
      {openOrder && order.canFulfill && (
        <>
          <Button
            type="button"
            size="sm"
            data-sales-action="createShipment"
            disabled={busy || !hasFreeAllocation}
            onClick={(event) => open(event, { type: "createShipment", order })}
          >
            <PackageCheck aria-hidden="true" className="size-4" />
            {t.newShipment}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-sales-action="autoAllocate"
            disabled={
              busy ||
              order.backordered === 0 ||
              !order.lines.some(
                (line) =>
                  line.quantity > line.shipped + line.allocated && line.positions.length > 0,
              )
            }
            onClick={(event) => open(event, { type: "autoAllocate", order })}
          >
            {t.autoAllocate}
          </Button>
        </>
      )}
      {openOrder && order.canEdit && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-sales-action="reschedule"
          disabled={busy}
          onClick={(event) => open(event, { type: "reschedule", order })}
        >
          {t.reschedule}
        </Button>
      )}
      {(draft || openOrder) && canCancel && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-sales-action="cancelOrder"
          disabled={busy}
          onClick={(event) => open(event, { type: "cancelOrder", order })}
        >
          {t.cancelOrder}
        </Button>
      )}
    </div>
  );
}

function Overview({
  order,
  workspace,
  t,
}: {
  order: SalesOrderDetail;
  workspace: SalesWorkspace;
  t: SalesMessages;
}) {
  const f = useSalesDisplay();
  const commercial = order.commercial;
  const total = orderTotal(order);
  const label = workspace.sites.find(({ id }) => id === order.siteId)?.name;
  return (
    <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      <Term label={t.site}>
        <bdi>{label ?? "—"}</bdi>
      </Term>
      <Term label={t.due}>
        {order.dueDate === null ? (
          "—"
        ) : (
          <time dateTime={order.dueDate}>{f.date(order.dueDate)}</time>
        )}
      </Term>
      {order.delivery !== null && (
        <Term label={t.shipTo}>
          <bdi className="block font-medium">{order.delivery.recipient}</bdi>
          <bdi className="block whitespace-pre-line">{order.delivery.address}</bdi>
        </Term>
      )}
      {commercial !== null && order.dealId !== null && (
        <Term label={t.deal}>
          <Link
            href={`/deals/${encodeURIComponent(order.dealId)}`}
            className="inline-flex items-center gap-1 text-primary hover:underline"
            prefetch={false}
          >
            <bdi>{commercial.dealName}</bdi>
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </Term>
      )}
      {commercial !== null && total !== null && (
        <Term label={t.orderValue}>
          <bdi>{f.amount(total, commercial.currency)}</bdi>
        </Term>
      )}
    </dl>
  );
}

function OrderLineRow({
  line,
  order,
  busy,
  open,
  t,
}: {
  line: SalesOrderLine;
  order: SalesOrderDetail;
  busy: boolean;
  open: OpenSalesEditor;
  t: SalesMessages;
}) {
  const f = useSalesDisplay();
  const backordered =
    order.status === "cancelled" ? 0 : Math.max(0, line.quantity - line.shipped - line.allocated);
  const commercial = order.commercial;
  return (
    <tr data-sales-order-line-id={line.id}>
      <th scope="row" className={`${cellClass} text-start font-medium`}>
        <bdi className="block">
          {line.code} · {line.revision}
        </bdi>
        <bdi className="block font-normal text-muted-foreground">{line.name}</bdi>
        {line.note !== null && (
          <bdi className="mt-0.5 block font-normal text-muted-foreground">{line.note}</bdi>
        )}
      </th>
      <td className={cellClass}>
        <bdi>
          {f.quantity(line.quantity)} {line.unit}
        </bdi>
      </td>
      <td className={cellClass} data-sales-allocated={line.allocated}>
        {f.quantity(line.allocated)}
      </td>
      <td className={cellClass} data-sales-shipped={line.shipped}>
        {f.quantity(line.shipped)}
      </td>
      <td className={cellClass} data-sales-backordered={backordered}>
        {f.quantity(backordered)}
      </td>
      {commercial !== null && (
        <td className={`${cellClass} whitespace-nowrap`}>
          <bdi>{line.unitPrice === null ? "—" : f.amount(line.unitPrice, commercial.currency)}</bdi>
        </td>
      )}
      {order.canFulfill && (
        <td className={cellClass}>
          {backordered > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-sales-action="allocate"
              disabled={busy || line.positions.length === 0}
              onClick={(event) => open(event, { type: "allocate", order, line })}
            >
              {t.allocate}
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}

function OrderLines({
  order,
  busy,
  open,
  t,
}: {
  order: SalesOrderDetail;
  busy: boolean;
  open: OpenSalesEditor;
  t: SalesMessages;
}) {
  const f = useSalesDisplay();
  const commercial = order.commercial;
  const headers = [t.part, t.ordered, t.allocated, t.shipped, t.backorder];
  return (
    <section aria-label={t.products} className="min-w-0 rounded-lg border bg-card">
      <h3 className="px-3 py-3 text-base font-semibold">{t.products}</h3>
      <div className="overflow-x-auto border-t">
        <table aria-label={t.products} className="w-full min-w-[37rem]">
          <thead className="bg-muted/25">
            <tr>
              {headers.map((heading) => (
                <th key={heading} scope="col" className={columnClass}>
                  {heading}
                </th>
              ))}
              {commercial !== null && (
                <th scope="col" className={columnClass}>
                  {t.unitPrice}
                </th>
              )}
              {order.canFulfill && (
                <th scope="col" className={columnClass}>
                  <span className="sr-only">{t.allocate}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y">
            {order.lines.map((line) => (
              <OrderLineRow key={line.id} {...{ line, order, busy, open, t }} />
            ))}
          </tbody>
        </table>
      </div>
      {commercial !== null && commercial.charges.length > 0 && (
        <div className="grid gap-2 border-t p-3 sm:max-w-md sm:ms-auto">
          <h4 className="text-sm font-semibold">{t.extraCharges}</h4>
          <dl className="space-y-1.5 text-sm">
            {commercial.charges.map(({ label, amount }) => (
              <div key={label} className="flex justify-between gap-4">
                <dt>
                  <bdi>{label}</bdi>
                </dt>
                <dd className="tabular-nums">
                  <bdi>{f.amount(amount, commercial.currency)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}

function Allocations({
  order,
  open,
  busy,
  t,
}: {
  order: SalesOrderDetail;
  open: OpenSalesEditor;
  busy: boolean;
  t: SalesMessages;
}) {
  const f = useSalesDisplay();
  const allocations = order.lines.flatMap((line) =>
    line.allocations.map((allocation) => ({ line, allocation })),
  );
  if (!order.canFulfill && allocations.length === 0) return null;
  return (
    <section aria-label={t.activeAllocations} className="rounded-lg border bg-card">
      <h3 className="px-3 py-3 text-base font-semibold">{t.activeAllocations}</h3>
      {allocations.length === 0 ? (
        <p className="border-t px-3 py-2.5 text-sm text-muted-foreground">{t.noAllocations}</p>
      ) : (
        <ul className="divide-y border-t">
          {allocations.map(({ line, allocation }) => (
            <li
              key={allocation.id}
              data-sales-allocation-id={allocation.id}
              className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  <bdi>
                    {line.code} · {line.name}
                  </bdi>{" "}
                  ·{" "}
                  <bdi className="tabular-nums">
                    {f.quantity(allocation.quantity)} {line.unit}
                  </bdi>
                </p>
                <StockDetails {...allocation} t={t} />
                {allocation.committed > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t.committed} <bdi>{f.quantity(allocation.committed)}</bdi>
                  </p>
                )}
              </div>
              {order.canFulfill && allocation.quantity > allocation.committed && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-sales-action="deallocate"
                  disabled={busy}
                  onClick={(event) => open(event, { type: "deallocate", order, allocation })}
                >
                  {t.releaseAllocation}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ShipmentCard({
  order,
  shipment,
  canReadMovement,
  open,
  busy,
  t,
}: {
  order: SalesOrderDetail;
  shipment: SalesShipment;
  canReadMovement: boolean;
  open: OpenSalesEditor;
  busy: boolean;
  t: SalesMessages;
}) {
  const f = useSalesDisplay();
  const [preview, setPreview] = useState(false);
  const printButton = useRef<HTMLButtonElement>(null);
  const canPack = shipment.status === "draft" && order.canFulfill;
  const checked = shipment.lines.length > 0 && shipment.lines.every((line) => line.checked);
  const lines = new Map(order.lines.map((line) => [line.id, line]));
  return (
    <article
      data-sales-shipment-id={shipment.id}
      data-sales-shipment-status={shipment.status}
      className="border-t px-3 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 break-words text-sm font-semibold">
            <bdi>{shipment.reference}</bdi>
          </h4>
          <Badge variant={shipment.status === "shipped" ? "success" : "outline"}>
            {t[shipment.status]}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPack && (
            <>
              <Button
                type="button"
                size="sm"
                data-sales-action="postShipment"
                disabled={busy || !checked}
                onClick={(event) => open(event, { type: "postShipment", order, shipment })}
              >
                {t.postShipment}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-sales-action="cancelShipment"
                disabled={busy}
                onClick={(event) => open(event, { type: "cancelShipment", order, shipment })}
              >
                {t.cancelShipment}
              </Button>
            </>
          )}
          {order.delivery !== null && shipment.status !== "cancelled" && (
            <Button
              ref={printButton}
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              data-sales-action="viewPackingSlip"
              onClick={() => setPreview(true)}
            >
              <ClipboardList className="size-4" aria-hidden="true" />
              {t.viewPackingSlip}
            </Button>
          )}
        </div>
      </div>
      {shipment.status === "shipped" && (
        <dl className="mt-2 flex flex-wrap gap-3">
          {shipment.carrier !== null && (
            <Term label={t.carrier}>
              <bdi>{shipment.carrier}</bdi>
            </Term>
          )}
          {shipment.tracking !== null && (
            <Term label={t.tracking}>
              <bdi>{shipment.tracking}</bdi>
            </Term>
          )}
          {shipment.shippedOn !== null && (
            <Term label={t.shipDate}>
              <time dateTime={shipment.shippedOn}>{f.date(shipment.shippedOn)}</time>
            </Term>
          )}
        </dl>
      )}
      <details className="mt-2 rounded-md border bg-background" open={shipment.status === "draft"}>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t.packingList}</summary>
        <ul aria-label={t.packingList} className="divide-y border-t">
          {shipment.lines.map((line) => {
            const product = lines.get(line.lineId);
            return (
              <li
                key={line.id}
                data-sales-shipment-line-id={line.id}
                data-sales-packed={line.checked}
                className="flex flex-wrap items-start justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    <bdi>
                      {product?.code} · {product?.name}
                    </bdi>{" "}
                    ·{" "}
                    <bdi className="tabular-nums">
                      {f.quantity(line.quantity)} {product?.unit}
                    </bdi>
                  </p>
                  <StockDetails {...line} t={t} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={line.checked ? "success" : "outline"}>
                    {line.checked ? t.packed : t.unchecked}
                  </Badge>
                  {canPack && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-sales-action="checkShipmentLine"
                      disabled={busy}
                      onClick={(event) =>
                        open(event, { type: "checkShipmentLine", order, shipment, line })
                      }
                    >
                      {line.checked ? t.undoCheck : t.check}
                    </Button>
                  )}
                  {canReadMovement && line.eventId !== null && (
                    <Link
                      href={`/inventory/warehouse/operations?movementId=${encodeURIComponent(line.eventId)}`}
                      prefetch={false}
                      className="text-sm text-primary hover:underline"
                    >
                      {t.movement}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </details>
      {preview && order.delivery !== null && shipment.status !== "cancelled" && (
        <SalesPackingSlip
          {...{ order, shipment, t }}
          close={() => setPreview(false)}
          restoreFocus={() => printButton.current?.focus()}
        />
      )}
    </article>
  );
}

export function SalesDetail({
  workspace,
  order,
  open,
  busy,
  t,
}: {
  workspace: SalesWorkspace;
  order: SalesOrderDetail;
  open: OpenSalesEditor;
  busy: boolean;
  t: SalesMessages;
}) {
  const canReadMovement = workspace.sites.some(
    ({ id, canFulfill }) => id === order.siteId && canFulfill,
  );
  return (
    <div
      data-sales-order-detail={order.id}
      data-sales-order-detail-status={order.status}
      className="min-w-0 space-y-3"
    >
      <section aria-label={order.reference} className="space-y-4 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 break-words text-lg font-semibold">
              <bdi>{order.reference}</bdi>
            </h2>
            <SalesStatus {...{ order, t }} />
          </div>
          <OrderToolbar {...{ order, open, busy, t }} />
        </div>
        <Overview {...{ order, workspace, t }} />
      </section>
      <OrderLines {...{ order, open, busy, t }} />
      <Allocations {...{ order, open, busy, t }} />
      <section aria-label={t.shipments} className="rounded-lg border bg-card">
        <h3 className="px-3 py-3 text-base font-semibold">{t.shipments}</h3>
        {order.shipments.length === 0 ? (
          <p className="border-t px-3 py-2.5 text-sm text-muted-foreground">{t.noShipments}</p>
        ) : (
          order.shipments.map((shipment) => (
            <ShipmentCard
              key={shipment.id}
              {...{ order, shipment, canReadMovement, open, busy, t }}
            />
          ))
        )}
      </section>
    </div>
  );
}
