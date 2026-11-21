"use client";

import { ArrowLeftRight, HandCoins, Pencil, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useHydrated } from "@/lib/useHydrated";
import type { AssetsWorkspace } from "../../contracts";
import type { Kit, KitCheckout, KitWorkspace } from "../contracts";
import type { KitOpener } from "./KitDialog";
import { activeKitCheckout, kitModeLabel, kitRemaining, kitStatus } from "./kitView";
import type { KitWords } from "./messages";

type Display = {
  location: (id: string) => string;
  when: (at: string) => string;
  number: (value: number) => string;
};

function KitActions({
  kit,
  active,
  open,
  busy,
  words: t,
}: {
  kit: Kit;
  active: KitCheckout | undefined;
  open: KitOpener;
  busy: boolean;
  words: KitWords;
}) {
  if (active !== undefined) {
    return (
      <Button
        size="sm"
        disabled={busy}
        onClick={(event) => open(event.currentTarget, { type: "returnKit", kit, checkout: active })}
      >
        <Undo2 size={15} aria-hidden="true" /> {t.return}
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={(event) => open(event.currentTarget, { type: "saveKit", siteId: kit.siteId, kit })}
      >
        <Pencil size={15} aria-hidden="true" /> {t.edit}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={(event) => open(event.currentTarget, { type: "moveKit", kit })}
      >
        <ArrowLeftRight size={15} aria-hidden="true" /> {t.move}
      </Button>
      {kitStatus(kit, active) === "ready" && (
        <Button
          size="sm"
          disabled={busy}
          onClick={(event) => open(event.currentTarget, { type: "checkoutKit", kit })}
        >
          <HandCoins size={15} aria-hidden="true" /> {t.checkout}
        </Button>
      )}
    </div>
  );
}

function Contents({
  workspace,
  kit,
  display,
  words: t,
}: {
  workspace: AssetsWorkspace;
  kit: Kit;
  display: Display;
  words: KitWords;
}) {
  const assets = new Map(workspace.records.map((asset) => [asset.id, asset]));
  const models = new Map(workspace.models.map(({ id, name }) => [id, name]));
  return (
    <section className="space-y-2 p-4">
      <h3 className="font-semibold">{t.contents}</h3>
      {kit.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noContents}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {kit.lines.map((line) => {
            const asset = assets.get(line.assetId);
            const serial = asset?.tracking === "individual" ? asset.serial : null;
            return (
              <li
                key={line.id}
                data-kit-content-id={line.id}
                className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    <bdi>{asset?.name ?? t.asset}</bdi>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t[kitModeLabel[line.mode]]}
                    {line.modelId !== null && (
                      <bdi className="ms-2">{models.get(line.modelId)}</bdi>
                    )}
                    <bdi className="ms-2">{serial ?? asset?.code}</bdi>
                  </p>
                </div>
                <p className="whitespace-nowrap text-xs text-muted-foreground">
                  {t.packed} {display.number(line.packedQuantity)} / {display.number(line.quantity)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CheckoutSnapshot({
  checkout,
  returns,
  display,
  words: t,
}: {
  checkout: KitCheckout;
  returns: KitWorkspace["returns"];
  display: Display;
  words: KitWords;
}) {
  const active = checkout.closedAt === null;
  const names = new Map(checkout.lines.map((line) => [line.id, line.assetName]));
  return (
    <article data-kit-checkout-id={checkout.id} className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-semibold [overflow-wrap:anywhere]">
            <bdi>{checkout.kitName}</bdi>
            <bdi className="ms-2 text-xs font-normal text-muted-foreground">{checkout.kitCode}</bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            {t.revision} {display.number(checkout.definitionVersion)}
            {" · "}
            <bdi>{checkout.custodianName}</bdi>
            {" · "}
            <bdi>{display.location(checkout.locationId)}</bdi>
          </p>
        </div>
        <Badge variant="outline">{active ? t.out : t.closed}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        <time dateTime={checkout.at}>{display.when(checkout.at)}</time>
        {" · "}
        <bdi>{checkout.actor}</bdi>
      </p>
      {checkout.note !== null && (
        <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          <bdi>{checkout.note}</bdi>
        </p>
      )}
      <ul aria-label={t.allocations} className="divide-y rounded-md border">
        {checkout.lines.map((line) => (
          <li key={line.id} data-kit-snapshot-line={line.id} className="space-y-1 p-2.5 text-sm">
            <p className="font-medium [overflow-wrap:anywhere]">
              <bdi>{line.assetName}</bdi>
              <bdi className="ms-2 text-xs font-normal text-muted-foreground">
                {line.serial ?? line.assetCode}
              </bdi>
            </p>
            <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
              <span>
                {t.quantity} {display.number(line.quantity)}
              </span>
              <span>
                {t.returned} {display.number(line.returned)}
              </span>
              {line.mode === "consumable_pool" && (
                <span>
                  {t.used} {display.number(line.consumed)}
                </span>
              )}
              <span>
                {t.remaining} {display.number(kitRemaining(line))}
              </span>
            </p>
          </li>
        ))}
      </ul>
      {returns.length > 0 && (
        <ol className="divide-y">
          {returns.map((entry) => (
            <li key={entry.id} data-kit-return-id={entry.id} className="space-y-1 py-2">
              <div className="flex flex-wrap justify-between gap-x-2 text-xs text-muted-foreground">
                <span>
                  {t.returned} · {t[entry.condition]} · <bdi>{entry.actor}</bdi>
                </span>
                <time dateTime={entry.at}>{display.when(entry.at)}</time>
              </div>
              {entry.lines.map((row) => (
                <p key={row.lineId} className="text-xs">
                  <bdi>{names.get(row.lineId) ?? t.asset}</bdi>
                  <span className="ms-2 text-muted-foreground">
                    {t.returned} {display.number(row.returned)}
                  </span>
                  {row.consumed > 0 && (
                    <span className="ms-2 text-muted-foreground">
                      {t.used} {display.number(row.consumed)}
                    </span>
                  )}
                </p>
              ))}
              {entry.note !== null && (
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <bdi>{entry.note}</bdi>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export function KitDetail({
  kit,
  workspace,
  locationLabels,
  locale,
  busy,
  open,
  words: t,
}: {
  kit: Kit;
  workspace: AssetsWorkspace;
  locationLabels: ReadonlyMap<string, string>;
  locale: string;
  busy: boolean;
  open?: KitOpener;
  words: KitWords;
}) {
  const hydrated = useHydrated();
  const numbers = hydrated ? new Intl.NumberFormat(locale) : null;
  const dates = hydrated
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : null;
  const display = {
    location: (id: string) => locationLabels.get(id) ?? "—",
    number: (value: number) => numbers?.format(value) ?? String(value),
    when: (at: string) => dates?.format(new Date(at)) ?? at.slice(0, 10),
  };
  const checkouts = (workspace.kits?.checkouts ?? [])
    .filter(({ kitId }) => kitId === kit.id)
    .sort((a, b) => b.at.localeCompare(a.at));
  const activity = (workspace.kits?.history ?? [])
    .filter(({ kitId }) => kitId === kit.id)
    .sort((a, b) => b.version - a.version);
  const active = activeKitCheckout(workspace, kit.id);
  return (
    <section
      id="kit-details"
      aria-label={t.kitDetails}
      data-kit-detail-id={kit.id}
      className="min-w-0 divide-y rounded-lg border bg-card text-sm"
    >
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            <bdi>{kit.code}</bdi>
          </p>
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
            <bdi>{kit.name}</bdi>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" data-kit-status={kitStatus(kit, active)}>
            {t[kitStatus(kit, active)]}
          </Badge>
          <bdi>{display.location(kit.locationId)}</bdi>
          <span>
            {t.revision} {display.number(kit.definitionVersion)}
          </span>
        </div>
        {active !== undefined && (
          <dl className="text-sm" data-kit-holder>
            <dt className="text-xs text-muted-foreground">{t.holder}</dt>
            <dd className="mt-0.5 font-medium [overflow-wrap:anywhere]">
              <bdi>{active.custodianName}</bdi>
            </dd>
          </dl>
        )}
        {open !== undefined && <KitActions {...{ kit, active, open, busy }} words={t} />}
      </div>
      <Contents {...{ workspace, kit, display }} words={t} />
      <section className="space-y-3 p-4">
        <h3 className="font-semibold">{t.history}</h3>
        {checkouts.length === 0 ? (
          <p className="text-muted-foreground">{t.noHistory}</p>
        ) : (
          checkouts.map((checkout) => (
            <CheckoutSnapshot
              key={checkout.id}
              checkout={checkout}
              returns={
                workspace.kits?.returns.filter(({ checkoutId }) => checkoutId === checkout.id) ?? []
              }
              display={display}
              words={t}
            />
          ))
        )}
      </section>
      {activity.length > 0 && (
        <section className="space-y-2 p-4">
          <h3 className="font-semibold">{t.activity}</h3>
          <ol className="divide-y">
            {activity.map((event) => (
              <li key={event.id} data-kit-activity-id={event.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <p className="font-medium">{t[event.kind]}</p>
                  <time dateTime={event.at} className="text-xs text-muted-foreground">
                    {display.when(event.at)}
                  </time>
                </div>
                <p className="text-xs text-muted-foreground">
                  <bdi>{event.actor}</bdi>
                </p>
                {event.kind === "moved" && (
                  <p className="text-xs text-muted-foreground">
                    <bdi>
                      {event.fromLocationId === null ? "—" : display.location(event.fromLocationId)}
                    </bdi>
                    <span aria-hidden="true" className="mx-1">
                      →
                    </span>
                    <bdi>{display.location(event.locationId)}</bdi>
                  </p>
                )}
                {event.note !== null && (
                  <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                    <bdi>{event.note}</bdi>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  );
}
