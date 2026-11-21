"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { ProductionDetail, SubcontractView } from "../../production/contracts";
import type { ProductionMessages } from "../../production/ui/messages";
import { useProductionNumber } from "../../production/ui/ProductionFields";
import type { OpenProductionEditor } from "../../production/ui/types";
import { purchaseOrderHref } from "../../purchasing/ui/types";
import { type SubcontractMessages, subcontractMessages } from "./messages";
import { availableDispatches, custodyRemaining } from "./types";

type PanelProps = {
  build: ProductionDetail;
  busy: boolean;
  open: OpenProductionEditor;
  t: ProductionMessages;
};

function CustodyRows({
  build,
  busy,
  open,
  t,
  labels,
  link,
}: PanelProps & { labels: SubcontractMessages; link: SubcontractView }) {
  const number = useProductionNumber();
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-medium">{labels.supplierCustody}</h4>
      {link.custody.length === 0 ? (
        <p className="text-sm text-muted-foreground">{labels.noStockInCustody}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {link.custody.map((dispatch) => {
            const { id, materialId, quantity, consumed, returned, lot, serial } = dispatch;
            const part = build.materials.find((material) => material.id === materialId)?.part;
            const remaining = custodyRemaining(dispatch);
            return (
              <li key={id} className="space-y-2 p-2.5" data-subcontract-dispatch-id={id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 text-sm">
                    {part !== undefined && (
                      <div className="break-words font-medium">
                        <bdi>
                          {part.code} · {part.name}
                        </bdi>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 break-words text-xs text-muted-foreground">
                      {lot !== null && (
                        <span>
                          {t.lot} <bdi>{lot}</bdi>
                        </span>
                      )}
                      {serial !== null && (
                        <span>
                          {t.serial} <bdi>{serial}</bdi>
                        </span>
                      )}
                    </div>
                  </div>
                  {build.canManage && link.canReturn && remaining > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      data-production-action="returnSubcontractMaterial"
                      onClick={(event) =>
                        open(event, { type: "returnSubcontractMaterial", build, dispatch })
                      }
                    >
                      {labels.returnSubcontractMaterial}
                    </Button>
                  )}
                </div>
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {(
                    [
                      [labels.inCustody, remaining],
                      [labels.dispatched, quantity],
                      [labels.used, consumed],
                      [labels.returned, returned],
                    ] as const
                  ).map(([label, amount]) => (
                    <div key={label} className="flex gap-1">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium tabular-nums">
                        <bdi>{number(amount)}</bdi>
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SubcontractPanel({ build, busy, open, t }: PanelProps) {
  const labels = subcontractMessages[useLocale()];
  const { subcontract: link, subcontractOptions: options } = build;
  if (link === null && options === null) return null;
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-3"
      aria-labelledby="subcontract-heading"
      data-subcontract-panel
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="subcontract-heading" className="text-sm font-semibold">
          {labels.title}
        </h3>
        {build.canManage &&
          link === null &&
          options !== null &&
          options.lines.length > 0 &&
          options.bins.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-production-action="linkSubcontract"
              onClick={(event) => open(event, { type: "linkSubcontract", build, options })}
            >
              {labels.linkSubcontract}
            </Button>
          )}
        {build.canManage && link?.canDispatch === true && (
          <Button
            size="sm"
            disabled={busy || availableDispatches(build, link).length === 0}
            data-production-action="dispatchSubcontract"
            onClick={(event) => open(event, { type: "dispatchSubcontract", build, link })}
          >
            {labels.dispatchSubcontract}
          </Button>
        )}
      </div>
      {link === null && options !== null && (
        <div className="space-y-1 text-sm text-muted-foreground">
          {options.lines.length === 0 && (
            <p>
              {labels.noPurchaseLines}{" "}
              <Link
                href={purchaseOrderHref(build.siteId)}
                prefetch={false}
                className="text-primary hover:underline"
              >
                {labels.openPurchaseOrder}
              </Link>
            </p>
          )}
          {options.bins.length === 0 && <p>{labels.noSupplierBin}</p>}
        </div>
      )}
      {link !== null && (
        <>
          <dl className="flex flex-wrap items-start gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{labels.purchaseOrder}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {link.orderId !== null && (
                  <Link
                    href={purchaseOrderHref(build.siteId, link.orderId)}
                    prefetch={false}
                    className="break-words text-primary underline-offset-4 hover:underline"
                    data-subcontract-purchase-order-id={link.orderId}
                  >
                    <bdi>{link.reference ?? labels.openPurchaseOrder}</bdi>
                  </Link>
                )}
                <Badge variant="outline" data-subcontract-purchase-status={link.orderStatus}>
                  {labels[link.orderStatus]}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{labels.supplierLocation}</dt>
              <dd className="break-words">
                <bdi>{link.supplierBin}</bdi>
              </dd>
            </div>
          </dl>
          <CustodyRows {...{ build, busy, open, t, labels, link }} />
        </>
      )}
    </section>
  );
}
