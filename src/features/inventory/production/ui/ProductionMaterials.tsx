"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { bomHref } from "../../bom/ui/links";
import { subcontractMessages } from "../../subcontract/ui/messages";
import { companyProvides } from "../../subcontract/ui/types";
import type { ProductionDetail, ProductionMaterial, ProductionPosition } from "../contracts";
import type { ProductionMessages } from "./messages";
import { useProductionNumber } from "./ProductionFields";
import { materialRemaining, type OpenProductionEditor } from "./types";

export function PositionLabel({
  position,
  t,
}: {
  position: ProductionPosition;
  t: ProductionMessages;
}) {
  return (
    <span className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 break-words">
      <bdi>{position.location}</bdi>
      {position.lot !== null && (
        <span>
          {t.lot} <bdi>{position.lot}</bdi>
        </span>
      )}
      {position.serial !== null && (
        <span>
          {t.serial} <bdi>{position.serial}</bdi>
        </span>
      )}
    </span>
  );
}

function MaterialRow({
  build,
  material,
  busy,
  open,
  t,
}: {
  build: ProductionDetail;
  material: ProductionMaterial;
  busy: boolean;
  open: OpenProductionEditor;
  t: ProductionMessages;
}) {
  const number = useProductionNumber();
  const labels = subcontractMessages[useLocale()];
  const linked = build.subcontract;
  const supplied = companyProvides(linked, material);
  const mayAllocate =
    build.canManage &&
    (build.status === "planned" || build.status === "issued") &&
    !material.consumable &&
    supplied &&
    linked?.orderStatus !== "cancelled" &&
    materialRemaining(material, linked) > 0;
  const mayDeallocate =
    build.canManage && build.status !== "closed" && build.status !== "cancelled";
  const available = material.positions.some(({ free }) => free > 0);
  return (
    <li
      className="min-w-0 space-y-3 p-3"
      data-production-material-id={material.id}
      data-production-material-part-id={material.part.id}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="break-words text-sm font-medium">
            <bdi>
              {material.part.code} · {material.part.revision} — {material.part.name}
            </bdi>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {material.releaseId !== null && (
              <Link
                href={bomHref({ releaseId: material.releaseId, siteId: build.siteId })}
                prefetch={false}
                className="text-xs text-primary underline-offset-4 hover:underline"
                data-production-material-release={material.releaseId}
              >
                {t.approvedBom}
              </Link>
            )}
            {material.consumable && <Badge variant="outline">{t.consumable}</Badge>}
            {linked !== null && (
              <Badge variant="outline">
                {supplied ? labels.companyProvided : labels.supplierProvided}
              </Badge>
            )}
          </div>
        </div>
        {mayAllocate && (
          <Button
            size="sm"
            variant="outline"
            data-production-action="allocate"
            disabled={busy || !available}
            onClick={(event) => open(event, { type: "allocate", build, material })}
          >
            {t.allocate}
          </Button>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">{t.required}</dt>
          <dd className="tabular-nums" data-production-required={material.demand}>
            <bdi>
              {number(material.demand)} {material.part.unit}
            </bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.allocated}</dt>
          <dd className="tabular-nums" data-production-allocated={material.allocated}>
            <bdi>{number(material.allocated)}</bdi>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t.consumed}</dt>
          <dd className="tabular-nums" data-production-consumed={material.consumed}>
            <bdi>{number(material.consumed)}</bdi>
          </dd>
        </div>
      </dl>
      {mayAllocate && !available && (
        <p className="text-xs text-muted-foreground">{t.noEligibleStock}</p>
      )}
      {material.allocations.length > 0 && (
        <ul className="divide-y rounded-md border">
          {material.allocations.map(({ position, quantity }) => (
            <li
              key={position.id}
              className="flex min-w-0 flex-wrap items-center justify-between gap-2 p-2 text-xs"
              data-production-allocation-position={position.id}
              data-production-allocation-quantity={quantity}
            >
              <PositionLabel position={position} t={t} />
              <div className="flex items-center gap-2">
                <bdi className="tabular-nums">
                  {number(quantity)} {material.part.unit}
                </bdi>
                {mayDeallocate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    data-production-action="deallocate"
                    disabled={busy}
                    onClick={(event) =>
                      open(event, { type: "deallocate", build, material, position, quantity })
                    }
                  >
                    {t.releaseStock}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProductionMaterials({
  build,
  busy,
  open,
  t,
}: {
  build: ProductionDetail;
  busy: boolean;
  open: OpenProductionEditor;
  t: ProductionMessages;
}) {
  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-labelledby="production-materials">
      <h3 className="p-3 text-sm font-semibold" id="production-materials">
        {t.materials}
      </h3>
      {build.materials.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noMaterials}</p>
      ) : (
        <ul className="divide-y border-t">
          {build.materials.map((material) => (
            <MaterialRow key={material.id} {...{ build, material, busy, open, t }} />
          ))}
        </ul>
      )}
    </section>
  );
}
