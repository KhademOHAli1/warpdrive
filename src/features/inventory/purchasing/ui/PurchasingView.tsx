"use client";

import { ClipboardList, PackageCheck, Plus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FileAttachments } from "@/features/files/FileAttachments";
import { useFormatters } from "@/lib/useFormatters";
import { CatalogField, CatalogSelect } from "../../catalog/ui/CatalogFields";
import type {
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStatus,
  PurchasePrice,
  PurchaseReceiptLine,
  PurchasingSite,
  PurchasingWorkspace,
} from "../contracts";
import type { PurchaseMessages } from "./messages";
import { type OpenPurchaseEditor, purchaseOrderHref } from "./types";

const titleClass = "text-base font-semibold";
const headingCell = "px-3 py-2 text-start text-xs font-medium text-muted-foreground";
const dataCell = "px-3 py-2.5 text-start align-top text-sm";
const narrowCell = `${dataCell} whitespace-nowrap tabular-nums`;

function StatusBadge({ status, t }: { status: PurchaseOrderStatus; t: PurchaseMessages }) {
  return <Badge variant={status === "received" ? "success" : "outline"}>{t[status]}</Badge>;
}

function ScopePicker({
  sites,
  siteId,
  busy,
  selectSite,
  t,
}: {
  sites: PurchasingSite[];
  siteId: string;
  busy: boolean;
  selectSite: (siteId: string) => void;
  t: PurchaseMessages;
}) {
  return (
    <div className="mb-4 max-w-sm">
      <CatalogField label={t.site}>
        <CatalogSelect
          ariaLabel={t.site}
          value={siteId}
          options={sites.map(({ id, name, code, archived }) => ({
            value: id,
            label: `${name} · ${code}${archived ? ` (${t.siteArchived})` : ""}`,
          }))}
          disabled={busy}
          onChange={selectSite}
        />
      </CatalogField>
    </div>
  );
}

function OrderList({
  site,
  workspace,
  busy,
  open,
  t,
}: {
  site: PurchasingSite;
  workspace: PurchasingWorkspace;
  busy: boolean;
  open: OpenPurchaseEditor;
  t: PurchaseMessages;
}) {
  const { dateOnly } = useFormatters();
  return (
    <section className="min-w-0 self-start rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-3">
        <h2 className={titleClass}>{t.orders}</h2>
        {site.canBuy && !site.archived && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={(event) => open(event, { type: "draft", order: null })}
          >
            <Plus aria-hidden="true" />
            {t.newOrder}
          </Button>
        )}
      </div>
      {workspace.orders.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">{t.noOrders}</p>
      ) : (
        <ul className="divide-y">
          {workspace.orders.map((order) => {
            const selected = order.id === workspace.selectedOrderId;
            return (
              <li key={order.id}>
                <Link
                  href={purchaseOrderHref(site.id, order.id)}
                  prefetch={false}
                  aria-label={order.reference}
                  aria-current={selected ? "page" : undefined}
                  className="block px-3 py-2.5 text-sm hover:bg-muted/40 aria-[current=page]:bg-muted/60"
                  data-purchase-order-id={order.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <bdi className="break-all font-medium">{order.reference}</bdi>
                    <StatusBadge status={order.status} t={t} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <bdi>{order.supplierName}</bdi>
                    {order.expectedDate !== null && (
                      <time dateTime={order.expectedDate}>{dateOnly(order.expectedDate)}</time>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function OrderActions({
  order,
  busy,
  open,
  t,
}: {
  order: PurchaseOrder;
  busy: boolean;
  open: OpenPurchaseEditor;
  t: PurchaseMessages;
}) {
  const draft = order.status === "draft";
  const linked = order.lines.some(({ subcontracted }) => subcontracted === true);
  const mayCancel =
    order.canEdit &&
    order.subcontractCancellationBlocked !== true &&
    (draft || order.status === "open" || order.status === "partial");
  if (!order.canReceive && !(draft && order.canEdit) && !mayCancel) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {draft && order.canEdit && (
        <>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={(event) => open(event, { type: "issue", order })}
          >
            {t.issue}
          </Button>
          {!linked && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(event) => open(event, { type: "draft", order })}
            >
              {t.editOrder}
            </Button>
          )}
        </>
      )}
      {order.canReceive && (order.status === "open" || order.status === "partial") && (
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={(event) => open(event, { type: "receive", order })}
        >
          <PackageCheck aria-hidden="true" />
          {t.receive}
        </Button>
      )}
      {mayCancel && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => open(event, { type: "cancel", order })}
        >
          {t.cancelOrder}
        </Button>
      )}
    </div>
  );
}

function OrderMetadata({ order, t }: { order: PurchaseOrder; t: PurchaseMessages }) {
  const { dateOnly } = useFormatters();
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-muted-foreground">{t.supplier}</dt>
        <dd>
          <bdi>{order.supplierName}</bdi>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t.receivingBin}</dt>
        <dd>
          <bdi>{order.locationName}</bdi>
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t.expectedDate}</dt>
        <dd>
          {order.expectedDate === null ? (
            "—"
          ) : (
            <time dateTime={order.expectedDate}>{dateOnly(order.expectedDate)}</time>
          )}
        </dd>
      </div>
    </dl>
  );
}

const moneyScale = 10_000n;

function extendedPackCost(amount: string, units: number, unitsPerPack: number) {
  const [integer, fraction = ""] = amount.split(".");
  const scaledPackPrice = BigInt(integer ?? "0") * moneyScale + BigInt(fraction.padEnd(4, "0"));
  const divisor = BigInt(unitsPerPack);
  // Rounding the cumulative value keeps display totals stable across partial deliveries.
  const value = (scaledPackPrice * BigInt(units) + divisor / 2n) / divisor;
  return `${value / moneyScale}.${String(value % moneyScale).padStart(4, "0")}`;
}

function PriceCells({
  price,
  line,
  t,
}: {
  price: PurchasePrice | undefined;
  line: PurchaseOrderLine;
  t: PurchaseMessages;
}) {
  const { currency } = useFormatters();
  if (price === undefined) {
    return (
      <td colSpan={3} className={dataCell}>
        <span className="text-muted-foreground">{t.noQuote}</span>
      </td>
    );
  }
  const money = (amount: string) => `${currency(amount, price.currency)} ${price.currency}`;
  return (
    <>
      <td className={narrowCell}>
        <bdi>{money(price.amount)}</bdi>
      </td>
      <td className={narrowCell}>
        <bdi>{money(extendedPackCost(price.amount, line.orderedUnits, line.packQuantity))}</bdi>
      </td>
      <td className={narrowCell}>
        <bdi>{money(extendedPackCost(price.amount, line.receivedUnits, line.packQuantity))}</bdi>
      </td>
    </>
  );
}

function OrderLines({ order, t }: { order: PurchaseOrder; t: PurchaseMessages }) {
  const { number } = useFormatters();
  const prices =
    order.pricing === undefined
      ? undefined
      : new Map(order.pricing.map((price) => [price.lineId, price]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full" aria-label={t.orderLine}>
        <thead className="border-y bg-muted/40">
          <tr>
            <th scope="col" className={headingCell}>
              {t.orderLine}
            </th>
            <th scope="col" className={headingCell}>
              {t.packs}
            </th>
            <th scope="col" className={headingCell}>
              {t.stockUnits}
            </th>
            <th scope="col" className={headingCell}>
              {t.received}
            </th>
            <th scope="col" className={headingCell}>
              {t.remaining}
            </th>
            {prices !== undefined && (
              <>
                <th scope="col" className={headingCell}>
                  {t.unitCost}
                </th>
                <th scope="col" className={headingCell}>
                  {t.orderedCost}
                </th>
                <th scope="col" className={headingCell}>
                  {t.receivedCost}
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {order.lines.map((line) => (
            <tr key={line.id} data-purchase-line-id={line.id}>
              <td className={dataCell}>
                <bdi className="font-medium">
                  {line.partCode} · {line.revision} — {line.partName}
                </bdi>
                <div className="text-xs text-muted-foreground">
                  <bdi>{line.partNumber}</bdi>
                </div>
                {line.subcontracted === true && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" data-purchase-subcontract-line>
                      {t.subcontractLine}
                    </Badge>
                    {line.subcontractBuildId !== undefined && (
                      <Link
                        href={`/inventory/production?buildId=${encodeURIComponent(line.subcontractBuildId)}`}
                        prefetch={false}
                        className="text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {t.openSubcontractBuild}
                      </Link>
                    )}
                  </div>
                )}
              </td>
              <td className={narrowCell}>
                <bdi>{number(line.packs)}</bdi>
                <div className="text-xs text-muted-foreground">
                  <bdi>{number(line.packQuantity)}</bdi> {t.unitsPerPack}
                </div>
              </td>
              <td className={narrowCell} data-purchase-ordered-units={line.orderedUnits}>
                <bdi>
                  {number(line.orderedUnits)} {line.stockUnit}
                </bdi>
              </td>
              <td className={narrowCell} data-purchase-received-units={line.receivedUnits}>
                <bdi>{number(line.receivedUnits)}</bdi>
              </td>
              <td className={narrowCell}>
                <bdi>{number(line.orderedUnits - line.receivedUnits)}</bdi>
              </td>
              {prices !== undefined && <PriceCells price={prices.get(line.id)} {...{ line, t }} />}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReceiptLineRow({
  row,
  line,
  t,
}: {
  row: PurchaseReceiptLine;
  line: PurchaseOrderLine | undefined;
  t: PurchaseMessages;
}) {
  const format = useFormatters();
  return (
    <tr
      data-purchase-receipt-disposition={row.disposition}
      data-purchase-held-for-release={row.heldForRelease}
    >
      <td className={dataCell}>
        <bdi>{line === undefined ? "—" : `${line.partCode} · ${line.revision}`}</bdi>
      </td>
      <td className={narrowCell}>
        <bdi>{format.number(row.quantity)}</bdi>
      </td>
      <td className={dataCell}>
        <bdi>{row.lot ?? "—"}</bdi>
      </td>
      <td className={dataCell}>
        <bdi>{row.serial ?? "—"}</bdi>
      </td>
      <td className={narrowCell}>
        {row.expiryDate === null ? (
          "—"
        ) : (
          <time dateTime={row.expiryDate}>{format.dateOnly(row.expiryDate)}</time>
        )}
      </td>
      <td className={dataCell}>
        <Badge variant={row.disposition === "accepted" ? "success" : "destructive"}>
          {t[row.disposition]}
        </Badge>
        {row.heldForRelease === true && (
          <p className="mt-1 text-xs text-muted-foreground">{t.awaitingSubcontractRelease}</p>
        )}
        {row.reason !== null && (
          <p className="mt-1 max-w-48 break-words text-xs text-muted-foreground">
            <bdi>{row.reason}</bdi>
          </p>
        )}
      </td>
    </tr>
  );
}

function Receipts({
  order,
  canAttach,
  t,
}: {
  order: PurchaseOrder;
  canAttach: boolean;
  t: PurchaseMessages;
}) {
  const { dateTime } = useFormatters();
  const orderLines = new Map(order.lines.map((line) => [line.id, line]));
  return (
    <section className="rounded-lg border bg-card">
      <h2 className={`${titleClass} px-3 py-3`}>{t.receipts}</h2>
      {order.receipts.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noReceipts}</p>
      ) : (
        <div className="space-y-3 px-3 pb-3">
          {order.receipts.map((receipt) => (
            <article
              className="rounded-md border"
              key={receipt.id}
              data-purchase-receipt-id={receipt.id}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 p-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t.packingSlip}</p>
                  <h3 className="text-sm font-medium">
                    <bdi>{receipt.supplierSlip}</bdi>
                  </h3>
                </div>
                <div className="text-xs text-muted-foreground">
                  {t.posted} <time dateTime={receipt.postedAt}>{dateTime(receipt.postedAt)}</time>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" aria-label={receipt.supplierSlip}>
                  <thead className="border-y bg-muted/40">
                    <tr>
                      <th scope="col" className={headingCell}>
                        {t.orderLine}
                      </th>
                      <th scope="col" className={headingCell}>
                        {t.quantity}
                      </th>
                      <th scope="col" className={headingCell}>
                        {t.lot}
                      </th>
                      <th scope="col" className={headingCell}>
                        {t.serial}
                      </th>
                      <th scope="col" className={headingCell}>
                        {t.expiryDate}
                      </th>
                      <th scope="col" className={headingCell}>
                        {t.disposition}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {receipt.lines.map((row) => (
                      <ReceiptLineRow
                        key={row.id}
                        row={row}
                        line={orderLines.get(row.lineId)}
                        t={t}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="space-y-2 border-t p-3">
                <h4 className="text-sm font-medium">{t.evidence}</h4>
                {canAttach && (
                  <p className="text-xs text-muted-foreground">{t.evidenceDescription}</p>
                )}
                <FileAttachments
                  entityType="inventory_purchase_receipt"
                  entityId={receipt.id}
                  readOnly={!canAttach}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function OrderDetail({
  order,
  site,
  busy,
  open,
  t,
}: {
  order: PurchaseOrder;
  site: PurchasingSite;
  busy: boolean;
  open: OpenPurchaseEditor;
  t: PurchaseMessages;
}) {
  return (
    <div className="min-w-0 space-y-3" data-selected-purchase-order-id={order.id}>
      <section className="rounded-lg border bg-card">
        <div className="space-y-4 px-3 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className={`${titleClass} break-all`}>
                <bdi>{order.reference}</bdi>
              </h2>
              <StatusBadge status={order.status} t={t} />
            </div>
            <OrderActions {...{ order, busy, open, t }} />
          </div>
          <OrderMetadata {...{ order, t }} />
          {order.canEdit && order.subcontractCancellationBlocked === true && (
            <p className="text-sm text-muted-foreground">{t.subcontractCancellationBlocked}</p>
          )}
        </div>
        <OrderLines {...{ order, t }} />
      </section>
      <Receipts {...{ order, t }} canAttach={site.canReceive && !site.archived} />
    </div>
  );
}

export function PurchasingView({
  workspace,
  busy,
  selectSite,
  open,
  t,
}: {
  workspace: PurchasingWorkspace;
  busy: boolean;
  selectSite: (siteId: string) => void;
  open: OpenPurchaseEditor;
  t: PurchaseMessages;
}) {
  const site = workspace.sites.find(({ id }) => id === workspace.selectedSiteId);
  if (site === undefined) {
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t.noSites}</p>
    );
  }
  const selectedOrder = workspace.orders.find(({ id }) => id === workspace.selectedOrderId);
  return (
    <>
      <ScopePicker sites={workspace.sites} siteId={site.id} {...{ busy, selectSite, t }} />
      <div className="grid min-w-0 gap-3 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <OrderList {...{ site, workspace, busy, open, t }} />
        {selectedOrder === undefined ? (
          workspace.orders.length > 0 && (
            <section className="flex min-h-36 items-center gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              <ClipboardList aria-hidden="true" className="size-5 shrink-0" />
              {t.pickOrder}
            </section>
          )
        ) : (
          <OrderDetail order={selectedOrder} {...{ site, busy, open, t }} />
        )}
      </div>
    </>
  );
}
