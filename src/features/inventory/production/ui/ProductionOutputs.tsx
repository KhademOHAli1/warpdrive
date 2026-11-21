"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { ProductionDetail, ProductionOutput } from "../contracts";
import type { ProductionMessages } from "./messages";
import { ProductionTime, useProductionNumber } from "./ProductionFields";
import { PositionLabel } from "./ProductionMaterials";
import { batchRemaining, type OpenProductionEditor, productionHref } from "./types";

function OutputMaterials({ output, t }: { output: ProductionOutput; t: ProductionMessages }) {
  const number = useProductionNumber();
  if (output.inputs.length === 0) return null;
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer rounded-md p-2 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50">
        {t.genealogy}
      </summary>
      <ul className="divide-y border-t">
        {output.inputs.map(({ part, position, quantity, eventId }) => (
          <li
            key={eventId}
            className="min-w-0 space-y-1.5 p-2 text-xs"
            data-production-input-event={eventId}
          >
            <div className="flex min-w-0 flex-wrap justify-between gap-2">
              <bdi className="break-words font-medium">
                {part.code} · {part.revision} — {part.name}
              </bdi>
              <bdi className="tabular-nums">
                {number(quantity)} {part.unit}
              </bdi>
            </div>
            <div className="text-muted-foreground">
              <PositionLabel position={position} t={t} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <Link
                href={`/inventory/warehouse/operations?movementId=${encodeURIComponent(eventId)}`}
                prefetch={false}
                className="text-primary underline-offset-4 hover:underline"
              >
                {t.warehouseHistory}
              </Link>
              {position.sourceBuildId == null ? (
                position.buildOutputId !== null && (
                  <span className="text-muted-foreground">
                    {t.sourceOutput} <bdi>{position.buildOutputId.slice(0, 8)}</bdi>
                  </span>
                )
              ) : (
                <Link
                  href={productionHref({ buildId: position.sourceBuildId })}
                  prefetch={false}
                  className="text-primary underline-offset-4 hover:underline"
                  data-production-source-build-id={position.sourceBuildId}
                >
                  {t.sourceOutput} {position.buildOutputId?.slice(0, 8)}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function OutputRow({
  output,
  build,
  busy,
  open,
  t,
}: {
  output: ProductionOutput;
  build: ProductionDetail;
  busy: boolean;
  open: OpenProductionEditor;
  t: ProductionMessages;
}) {
  const number = useProductionNumber();
  const changingWip = build.canManage && output.status === "wip";
  const canReverse =
    build.canManage &&
    (build.status === "issued" || build.status === "on_hold" || build.status === "closed") &&
    (output.status === "completed" || output.status === "scrapped");
  const variant =
    output.status === "completed"
      ? "success"
      : output.status === "scrapped"
        ? "destructive"
        : "outline";
  return (
    <li
      className="min-w-0 space-y-3 p-3"
      data-production-output-id={output.id}
      data-production-output-status={output.status}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">
            {t.outputBatch} <bdi>{output.id.slice(0, 8)}</bdi> ·{" "}
            <bdi className="tabular-nums">{number(output.quantity)}</bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            <ProductionTime value={output.createdAt} />
          </p>
        </div>
        <Badge variant={variant}>{t[output.status]}</Badge>
      </div>
      {output.lot !== null && (
        <p className="break-words text-sm" data-production-output-lot={output.lot}>
          {t.lot} <bdi>{output.lot}</bdi>
        </p>
      )}
      {output.serials.length > 0 && (
        <details className="text-sm">
          <summary className="w-fit cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t.serials} <bdi>({number(output.serials.length)})</bdi>
          </summary>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {output.serials.map((serial) => (
              <li key={serial} data-production-output-serial={serial}>
                <Badge variant="outline" className="whitespace-normal break-all">
                  <bdi>{serial}</bdi>
                </Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
      {output.reason !== null && (
        <p className="break-words text-sm text-muted-foreground">
          <bdi>{output.reason}</bdi>
        </p>
      )}
      <OutputMaterials output={output} t={t} />
      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        {changingWip && build.status === "issued" && (
          <>
            <Button
              size="sm"
              data-production-action="completeBatch"
              disabled={busy}
              onClick={(event) => open(event, { type: "completeBatch", build, output })}
            >
              {t.completeBatch}
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-production-action="scrapBatch"
              disabled={busy}
              onClick={(event) => open(event, { type: "scrapBatch", build, output })}
            >
              {t.scrapBatch}
            </Button>
          </>
        )}
        {changingWip && (build.status === "issued" || build.status === "on_hold") && (
          <Button
            size="sm"
            variant="ghost"
            data-production-action="cancelBatch"
            disabled={busy}
            onClick={(event) => open(event, { type: "cancelBatch", build, output })}
          >
            {t.cancelBatch}
          </Button>
        )}
        {canReverse && (
          <Button
            size="sm"
            variant="outline"
            data-production-action="reverseOutput"
            disabled={busy}
            onClick={(event) => open(event, { type: "reverseOutput", build, output })}
          >
            {t.reverseOutput}
          </Button>
        )}
      </div>
    </li>
  );
}

export function ProductionOutputs({
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
  const mayStart = build.canManage && build.status === "issued";
  return (
    <section className="min-w-0 rounded-lg border bg-card" aria-labelledby="production-outputs">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        <h3 className="text-sm font-semibold" id="production-outputs">
          {t.batches}
        </h3>
        {mayStart && (
          <Button
            size="sm"
            variant="outline"
            data-production-action="startBatch"
            disabled={busy || batchRemaining(build) === 0}
            onClick={(event) => open(event, { type: "startBatch", build })}
          >
            {t.startBatch}
          </Button>
        )}
      </div>
      {build.outputs.length === 0 ? (
        <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noBatches}</p>
      ) : (
        <ul className="divide-y border-t">
          {build.outputs.map((output) => (
            <OutputRow key={output.id} {...{ output, build, busy, open, t }} />
          ))}
        </ul>
      )}
    </section>
  );
}
