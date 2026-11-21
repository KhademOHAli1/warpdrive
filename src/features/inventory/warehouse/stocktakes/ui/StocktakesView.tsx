"use client";

import { ClipboardCheck, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { warehouseMessages } from "../../ui/warehouseMessages";
import type {
  StocktakeDetail,
  StocktakeLine,
  StocktakeSite,
  StocktakeWorkspace,
  ValuationDetail,
  ValuationLine,
} from "../contracts";
import type { StocktakeMessages } from "./messages";
import { type OpenStocktakeEditor, stocktakeHref } from "./types";

const headerCell = "px-3 py-2 text-start font-medium";
const valueCell = "px-3 py-2.5 text-start tabular-nums";

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{children}</p>;
}

function Amount({ value, currency }: { value: string; currency: string }) {
  const { number } = useFormatters();
  return (
    <bdi>
      {number(value, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {currency}
    </bdi>
  );
}

function PartIdentity({
  line,
  t,
}: {
  line: Pick<StocktakeLine, "code" | "name" | "revision" | "lot" | "serial">;
  t: StocktakeMessages;
}) {
  return (
    <>
      <p className="font-medium">
        <bdi>
          {line.code} · {line.revision} — {line.name}
        </bdi>
      </p>
      {line.lot !== null && (
        <p className="text-xs text-muted-foreground">
          {t.lot} <bdi>{line.lot}</bdi>
        </p>
      )}
      {line.serial !== null && (
        <p className="text-xs text-muted-foreground">
          {t.serial} <bdi>{line.serial}</bdi>
        </p>
      )}
    </>
  );
}

function StocktakeCountRow({ line, t }: { line: StocktakeLine; t: StocktakeMessages }) {
  const { number, dateTime } = useFormatters();
  const difference =
    line.countedQuantity === null ? null : line.countedQuantity - line.expectedOnHand;
  return (
    <tr
      className="border-b align-top last:border-b-0"
      data-stocktake-position-id={line.positionId}
      data-stocktake-line-id={line.id}
    >
      <td className={valueCell}>
        <PartIdentity {...{ line, t }} />
      </td>
      <td className={valueCell} data-stocktake-expected={line.expectedOnHand}>
        <bdi>{number(line.expectedOnHand)}</bdi>
      </td>
      <td className={valueCell} data-stocktake-reserved={line.reserved}>
        <bdi>{number(line.reserved)}</bdi>
      </td>
      <td className={valueCell} data-stocktake-counted={line.countedQuantity ?? undefined}>
        {line.countedQuantity === null ? "—" : <bdi>{number(line.countedQuantity)}</bdi>}
      </td>
      <td className={valueCell} data-stocktake-difference={difference ?? undefined}>
        {difference === null ? "—" : <bdi>{number(difference, { signDisplay: "exceptZero" })}</bdi>}
      </td>
      <td className={valueCell}>
        {line.countedAt === null ? (
          "—"
        ) : (
          <time dateTime={line.countedAt}>{dateTime(line.countedAt)}</time>
        )}
        {line.countedBy !== null && (
          <p className="break-words text-xs text-muted-foreground">
            <bdi>{line.countedBy}</bdi>
          </p>
        )}
      </td>
      <td className={valueCell}>
        {line.reason !== null && (
          <p className="break-words">
            <bdi>{line.reason}</bdi>
          </p>
        )}
        {line.correctionEventId !== null && (
          <Link
            href={`/inventory/warehouse/operations?movementId=${line.correctionEventId}`}
            prefetch={false}
            className="inline-block whitespace-nowrap text-primary underline-offset-4 hover:underline"
            data-stocktake-correction-id={line.correctionEventId}
          >
            {t.movement}
          </Link>
        )}
        {line.reason === null && line.correctionEventId === null && "—"}
      </td>
    </tr>
  );
}

function CountDetails({
  stocktake,
  site,
  busy,
  open,
  t,
}: {
  stocktake: StocktakeDetail;
  site: StocktakeSite;
  busy: boolean;
  open: OpenStocktakeEditor;
  t: StocktakeMessages;
}) {
  const { dateTime } = useFormatters();
  const editable = site.canCount && stocktake.status === "draft";
  const complete =
    stocktake.lines.length > 0 && stocktake.lines.every((line) => line.countedQuantity !== null);
  return (
    <section className="min-w-0 space-y-3" data-selected-stocktake-id={stocktake.id}>
      <header className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold">
              <bdi>{stocktake.note}</bdi>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <bdi>{stocktake.locationName}</bdi>
            </p>
          </div>
          <Badge variant="outline" data-stocktake-status={stocktake.status}>
            {t[stocktake.status]}
          </Badge>
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">{t.created}</dt>
            <dd>
              <time dateTime={stocktake.createdAt}>{dateTime(stocktake.createdAt)}</time>
            </dd>
          </div>
          {stocktake.closedAt !== null && (
            <div>
              <dt className="text-xs text-muted-foreground">{t.closed}</dt>
              <dd>
                <time dateTime={stocktake.closedAt}>{dateTime(stocktake.closedAt)}</time>
              </dd>
            </div>
          )}
        </dl>
        {editable && (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={complete ? "outline" : "default"}
                disabled={busy}
                onClick={(event) => open(event, { type: "recordCounts", stocktake })}
              >
                {t.record}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={complete ? "default" : "outline"}
                disabled={busy || !complete}
                onClick={(event) => open(event, { type: "reconcileCount", stocktake })}
              >
                <ClipboardCheck aria-hidden="true" />
                {t.reconcile}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={(event) => open(event, { type: "cancelCount", stocktake })}
              >
                {t.cancel}
              </Button>
            </div>
            {!complete && <p className="mt-2 text-sm text-muted-foreground">{t.incomplete}</p>}
          </>
        )}
      </header>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[38rem] text-sm" aria-label={t.counts}>
          <thead className="border-b bg-muted/40 text-muted-foreground">
            <tr>
              {[t.part, t.expected, t.reserved, t.counted, t.difference, t.recorded, t.reason].map(
                (label) => (
                  <th key={label} scope="col" className={headerCell}>
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {stocktake.lines.map((line) => (
              <StocktakeCountRow key={line.id} {...{ line, t }} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CountsView({
  workspace,
  site,
  busy,
  open,
  t,
}: {
  workspace: StocktakeWorkspace;
  site: StocktakeSite;
  busy: boolean;
  open: OpenStocktakeEditor;
  t: StocktakeMessages;
}) {
  const { dateTime } = useFormatters();
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <h2 className="text-sm font-semibold">{t.stocktakeList}</h2>
          {site.canCount && workspace.locations.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(event) => open(event, { type: "startCount" })}
            >
              <Plus aria-hidden="true" />
              {t.start}
            </Button>
          )}
        </div>
        {workspace.stocktakes.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noStocktakes}</p>
        ) : (
          <ul className="divide-y border-t">
            {workspace.stocktakes.map((row) => {
              const selected = row.id === workspace.stocktake?.id;
              return (
                <li key={row.id}>
                  <Link
                    href={stocktakeHref(site.id, { stocktakeId: row.id })}
                    prefetch={false}
                    aria-current={selected ? "page" : undefined}
                    data-stocktake-id={row.id}
                    className="block min-w-0 px-3 py-2.5 hover:bg-muted/50 aria-[current=page]:bg-muted"
                  >
                    <span className="flex flex-wrap items-start justify-between gap-1.5">
                      <bdi className="break-words text-sm font-medium">{row.note}</bdi>
                      <Badge variant="outline">{t[row.status]}</Badge>
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      <bdi>{row.locationName}</bdi> ·{" "}
                      <time dateTime={row.createdAt}>{dateTime(row.createdAt)}</time>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {workspace.stocktake === null ? (
        <Empty>{t.selectStocktake}</Empty>
      ) : (
        <CountDetails stocktake={workspace.stocktake} {...{ site, busy, open, t }} />
      )}
    </div>
  );
}

function ValuationDetails({ value, t }: { value: ValuationDetail; t: StocktakeMessages }) {
  const { number, dateTime } = useFormatters();
  const counts = [
    { label: t.positions, value: value.positions },
    { label: t.quantity, value: value.quantity },
    { label: t.reserved, value: value.reserved },
    { label: t.unvaluedQuantity, value: value.unvaluedQuantity },
  ];
  return (
    <section className="min-w-0 space-y-3" data-selected-valuation-id={value.id}>
      <header className="rounded-lg border bg-card p-4">
        <h2 className="break-words text-base font-semibold">
          <bdi>{value.label}</bdi>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.captured} <time dateTime={value.capturedAt}>{dateTime(value.capturedAt)}</time>
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t.valuedTotal}</dt>
            <dd className="font-semibold" data-valuation-total={value.totalValue}>
              <Amount value={value.totalValue} currency={value.currency} />
            </dd>
          </div>
          {counts.map((count) => (
            <div key={count.label}>
              <dt className="text-xs text-muted-foreground">{count.label}</dt>
              <dd className="font-medium">
                <bdi>{number(count.value)}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      </header>
      {value.lines.length === 0 ? (
        <Empty>{t.noValuationLines}</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[38rem] text-sm" aria-label={t.valuations}>
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                {[t.part, t.bin, t.state, t.quantity, t.reserved, t.basis, t.value].map((label) => (
                  <th key={label} scope="col" className={headerCell}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {value.lines.map((line) => (
                <ValuationRow key={line.id} {...{ line, t }} currency={value.currency} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ValuationRow({
  line,
  currency,
  t,
}: {
  line: ValuationLine;
  currency: string;
  t: StocktakeMessages;
}) {
  const { number } = useFormatters();
  const state = warehouseMessages[useLocale()][line.stockState];
  return (
    <tr className="border-b align-top last:border-b-0" data-valuation-line-id={line.id}>
      <td className={valueCell}>
        <PartIdentity {...{ line, t }} />
      </td>
      <td className={valueCell}>
        <bdi>{line.locationName}</bdi>
      </td>
      <td className={valueCell}>{state}</td>
      <td className={valueCell}>
        <bdi>
          {number(line.quantity)} {line.stockUnit}
        </bdi>
      </td>
      <td className={valueCell}>
        <bdi>{number(line.reserved)}</bdi>
      </td>
      <td className={valueCell}>
        <p>{t[line.source]}</p>
        {line.basisAmount !== null && (
          <p className="text-xs text-muted-foreground">
            <Amount value={line.basisAmount} {...{ currency }} />
            {line.basisPackQuantity !== null && (
              <span>
                {" "}
                · {number(line.basisPackQuantity)} {t.unitsPerPack}
              </span>
            )}
          </p>
        )}
      </td>
      <td className={valueCell} data-valuation-line-value={line.value ?? undefined}>
        {line.value === null ? t.unvalued : <Amount value={line.value} {...{ currency }} />}
      </td>
    </tr>
  );
}

export function ValuationsView({
  access,
  site,
  busy,
  open,
  t,
}: {
  access: NonNullable<StocktakeWorkspace["valuationAccess"]>;
  site: StocktakeSite;
  busy: boolean;
  open: OpenStocktakeEditor;
  t: StocktakeMessages;
}) {
  const { dateTime } = useFormatters();
  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
      <section className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <h2 className="text-sm font-semibold">{t.valuationList}</h2>
          {site.canCaptureValues && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(event) => open(event, { type: "captureValuation" })}
            >
              <Plus aria-hidden="true" />
              {t.capture}
            </Button>
          )}
        </div>
        {access.valuations.length === 0 ? (
          <p className="px-3 pb-3 text-sm text-muted-foreground">{t.noValuations}</p>
        ) : (
          <ul className="divide-y border-t">
            {access.valuations.map((row) => {
              const selected = row.id === access.valuation?.id;
              return (
                <li key={row.id}>
                  <Link
                    href={stocktakeHref(site.id, { valuationId: row.id })}
                    prefetch={false}
                    aria-current={selected ? "page" : undefined}
                    data-valuation-id={row.id}
                    className="block min-w-0 px-3 py-2.5 hover:bg-muted/50 aria-[current=page]:bg-muted"
                  >
                    <bdi className="block break-words text-sm font-medium">{row.label}</bdi>
                    <time
                      dateTime={row.capturedAt}
                      className="mt-1 block text-xs text-muted-foreground"
                    >
                      {dateTime(row.capturedAt)}
                    </time>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {access.valuation === null ? (
        <Empty>{t.selectValuation}</Empty>
      ) : (
        <ValuationDetails value={access.valuation} {...{ t }} />
      )}
    </div>
  );
}
