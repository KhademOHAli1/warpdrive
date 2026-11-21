"use client";

import { Printer } from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useHydrated } from "@/lib/useHydrated";
import type { SalesOrderDetail, SalesShipment } from "../contracts";
import { useSalesDisplay } from "./display";
import type { SalesMessages } from "./messages";
import styles from "./packingSlip.module.css";

function PackingDocument({
  order,
  shipment,
  t,
}: {
  order: SalesOrderDetail;
  shipment: SalesShipment;
  t: SalesMessages;
}) {
  const f = useSalesDisplay();
  const products = new Map(order.lines.map((line) => [line.id, line]));
  const headings = [t.part, t.quantity, t.lot, t.serial, t.bin];
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t.reference}</dt>
          <dd>
            <bdi>{order.reference}</bdi>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.shipmentReference}</dt>
          <dd>
            <bdi>{shipment.reference}</bdi>
          </dd>
        </div>
        {order.delivery !== null && (
          <div>
            <dt className="font-semibold">{t.shipTo}</dt>
            <dd>
              <bdi className="block">{order.delivery.recipient}</bdi>
              <bdi className="block whitespace-pre-line">{order.delivery.address}</bdi>
            </dd>
          </div>
        )}
        <div>
          <dt className="font-semibold">{t.shipmentStatus}</dt>
          <dd>
            {t[shipment.status]}{" "}
            {shipment.shippedOn !== null && (
              <time dateTime={shipment.shippedOn}>{f.date(shipment.shippedOn)}</time>
            )}
          </dd>
          {shipment.carrier !== null && (
            <dd>
              <bdi>{shipment.carrier}</bdi>
            </dd>
          )}
          {shipment.tracking !== null && (
            <dd>
              <bdi>{shipment.tracking}</bdi>
            </dd>
          )}
        </div>
      </dl>
      <div className="overflow-x-auto print:overflow-visible">
        <table aria-label={t.packingList} className="w-full min-w-[34rem] text-start print:min-w-0">
          <thead>
            <tr>
              {headings.map((heading) => (
                <th
                  scope="col"
                  key={heading}
                  className="border-y px-2 py-2 text-start font-semibold"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shipment.lines.map((line) => {
              const part = products.get(line.lineId);
              return (
                <tr key={line.id} className="border-b align-top print:break-inside-avoid">
                  <th scope="row" className="break-words px-2 py-2 text-start font-medium">
                    <bdi>
                      {part?.code} · {part?.revision}
                    </bdi>
                    <bdi className="block font-normal">{part?.name}</bdi>
                  </th>
                  <td className="px-2 py-2">
                    <bdi>
                      {f.quantity(line.quantity)} {part?.unit}
                    </bdi>
                  </td>
                  <td className="break-words px-2 py-2">
                    <bdi>{line.lot ?? "—"}</bdi>
                  </td>
                  <td className="break-words px-2 py-2">
                    <bdi>{line.serial ?? "—"}</bdi>
                  </td>
                  <td className="break-words px-2 py-2">
                    <bdi>{line.location}</bdi>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SalesPackingSlip({
  order,
  shipment,
  close,
  restoreFocus,
  t,
}: {
  order: SalesOrderDetail;
  shipment: SalesShipment;
  close: () => void;
  restoreFocus: () => void;
  t: SalesMessages;
}) {
  const hydrated = useHydrated();
  const locale = useLocale();
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          data-sales-packing-preview
          className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.packingList}</DialogTitle>
            <DialogDescription>
              <bdi>{shipment.reference}</bdi>
            </DialogDescription>
          </DialogHeader>
          <PackingDocument {...{ order, shipment, t }} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t.close}
            </Button>
            <Button
              type="button"
              data-sales-action="printPackingSlip"
              disabled={!hydrated}
              onClick={() => window.print()}
            >
              <Printer aria-hidden="true" className="size-4" />
              {t.printPackingSlip}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {hydrated &&
        createPortal(
          <article
            dir={locale === "fa" ? "rtl" : "ltr"}
            className={`${styles.printDocument} ${BLOCK_CLASS} ph-no-capture`}
            data-sales-print-document
          >
            <h1 className="mb-5 text-xl font-semibold">{t.packingList}</h1>
            <PackingDocument {...{ order, shipment, t }} />
          </article>,
          window.document.body,
        )}
    </>
  );
}
