"use client";

import { ArrowLeftRight, HandCoins, NotebookPen, Pencil, Plus, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useHydrated } from "@/lib/useHydrated";
import type { AssetRecord, AssetsWorkspace } from "../../contracts";
import type { CustodyError, CustodyEvent, CustodyHolding, CustodyOutcome } from "../contracts";
import type { CustodyOpener } from "./CustodyDialogs";
import type { CustodyWords } from "./messages";

export function custodyErrorText(error: CustodyError | "transport", words: CustodyWords) {
  return error === "quantity" ? words.quantityError : words[error];
}

const eventLabels = { assign: "assigned", transfer: "transferred", return: "returned" } as const;

type Display = {
  number: (value: number) => string;
  time: (value: string) => string;
  location: (id: string) => string;
};

function HoldingList({
  holdings,
  record,
  display,
  busy,
  open,
  words: t,
}: {
  holdings: CustodyHolding[];
  record: AssetRecord;
  display: Display;
  busy: boolean;
  open?: CustodyOpener;
  words: CustodyWords;
}) {
  if (holdings.length === 0) return <p className="text-muted-foreground">{t.noHolder}</p>;
  return (
    <ul className="divide-y rounded-md border">
      {holdings.map((holding) => (
        <li key={holding.id} className="space-y-2 p-3" data-custody-holding-id={holding.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-medium [overflow-wrap:anywhere]">
              <bdi>{holding.custodianName}</bdi>
            </p>
            <p className="text-xs text-muted-foreground">
              {display.number(holding.quantity)} · {t[holding.condition]}
            </p>
          </div>
          {holding.locationId !== null && (
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              <bdi>{display.location(holding.locationId)}</bdi>
            </p>
          )}
          {open !== undefined && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={(event) =>
                  open(event.currentTarget, { type: "transfer", record, holding })
                }
              >
                <ArrowLeftRight aria-hidden="true" size={14} /> {t.transfer}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={(event) => open(event.currentTarget, { type: "return", record, holding })}
              >
                <Undo2 aria-hidden="true" size={14} /> {t.return}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function CustodyHistory({
  events,
  display,
  words: t,
}: {
  events: CustodyEvent[];
  display: Display;
  words: CustodyWords;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{t.custodyHistory}</h3>
      {events.length === 0 ? (
        <p className="text-muted-foreground">{t.noHistory}</p>
      ) : (
        <ol className="divide-y">
          {events.map((event) => (
            <li
              key={event.id}
              data-custody-event-id={event.id}
              className="space-y-1 py-2 first:pt-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                <p className="font-medium">
                  {t[eventLabels[event.action]]}
                  <span className="ms-2 text-xs text-muted-foreground">
                    {display.number(event.quantity)} · {t[event.condition]}
                  </span>
                </p>
                <time dateTime={event.at} className="text-xs text-muted-foreground">
                  {display.time(event.at)}
                </time>
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {event.fromCustodianName !== null && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{t.from}</dt>
                    <dd className="[overflow-wrap:anywhere]">
                      <bdi>{event.fromCustodianName}</bdi>
                    </dd>
                  </div>
                )}
                {event.toCustodianName !== null && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{t.to}</dt>
                    <dd className="[overflow-wrap:anywhere]">
                      <bdi>{event.toCustodianName}</bdi>
                    </dd>
                  </div>
                )}
                {event.sourceLocationId !== null && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{t.sourceLocation}</dt>
                    <dd className="[overflow-wrap:anywhere]">
                      <bdi>{display.location(event.sourceLocationId)}</bdi>
                    </dd>
                  </div>
                )}
                {event.locationId !== null && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{t.location}</dt>
                    <dd className="[overflow-wrap:anywhere]">
                      <bdi>{display.location(event.locationId)}</bdi>
                    </dd>
                  </div>
                )}
              </dl>
              <p className="text-xs text-muted-foreground">
                <bdi>{event.actor}</bdi>
              </p>
              {event.note !== null && (
                <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                  <bdi>{event.note}</bdi>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function AssetCustodyPanel({
  record,
  custody,
  display,
  busy,
  open,
  words: t,
}: {
  record: AssetRecord;
  custody: NonNullable<AssetsWorkspace["custody"]>;
  display: Display;
  busy: boolean;
  open?: CustodyOpener;
  words: CustodyWords;
}) {
  if (record.tracking === "consumable_pool") return null;
  const holdings = custody.holdings.filter(({ assetId }) => assetId === record.id);
  const events = custody.events
    .filter(({ assetId }) => assetId === record.id)
    .sort((a, b) => b.version - a.version);
  const canAssign =
    record.tracking === "individual"
      ? holdings.length === 0
      : record.balances.some(({ quantity }) => quantity > 0);
  return (
    <section aria-label={t.custody} className="space-y-4 p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{t.currentHolder}</h3>
          {open !== undefined && canAssign && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={(event) => open(event.currentTarget, { type: "assign", record })}
            >
              <HandCoins aria-hidden="true" size={14} /> {t.assign}
            </Button>
          )}
        </div>
        <HoldingList {...{ holdings, record, display, busy, words: t }} open={open} />
      </div>
      <CustodyHistory events={events} display={display} words={t} />
    </section>
  );
}

export function CustodianRoster({
  siteId,
  custody,
  busy,
  locale,
  open,
  words: t,
}: {
  siteId: string | null;
  custody: NonNullable<AssetsWorkspace["custody"]>;
  busy: boolean;
  locale: string;
  open: CustodyOpener;
  words: CustodyWords;
}) {
  const hydrated = useHydrated();
  const date = hydrated
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      })
    : null;
  if (siteId === null) {
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {t.noManagedSite}
      </p>
    );
  }
  const recipients = custody.custodians.filter((row) => row.siteId === siteId);
  const notes = new Map<string, typeof custody.notes>();
  for (const note of custody.notes) {
    if (note.siteId !== siteId) continue;
    const existing = notes.get(note.custodianId);
    if (existing === undefined) notes.set(note.custodianId, [note]);
    else existing.push(note);
  }

  return (
    <section aria-label={t.custodians} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t.custodians}</h2>
        <Button
          size="sm"
          disabled={busy}
          onClick={(event) => open(event.currentTarget, { type: "saveCustodian", siteId })}
        >
          <Plus aria-hidden="true" size={16} /> {t.addCustodian}
        </Button>
      </div>
      {recipients.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noCustodians}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {recipients.map((custodian) => {
            const ownNotes = notes.get(custodian.id);
            return (
              <li key={custodian.id} data-custodian-id={custodian.id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-medium [overflow-wrap:anywhere]">
                      <bdi>{custodian.name}</bdi>
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">
                        {custodian.kind === "staff" ? t.staff : t.named}
                      </Badge>
                      <Badge variant="outline">{custodian.active ? t.active : t.inactive}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={(event) =>
                        open(event.currentTarget, { type: "saveCustodian", siteId, custodian })
                      }
                    >
                      <Pencil aria-hidden="true" size={14} /> {t.editCustodian}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={(event) =>
                        open(event.currentTarget, { type: "noteCustodian", custodian })
                      }
                    >
                      <NotebookPen aria-hidden="true" size={14} /> {t.noteCustodian}
                    </Button>
                  </div>
                </div>
                {ownNotes !== undefined && (
                  <details className="rounded-md border bg-background p-2 text-sm">
                    <summary className="cursor-pointer px-1 font-medium">{t.notes}</summary>
                    <ol className="divide-y">
                      {[...ownNotes]
                        .sort((a, b) => b.at.localeCompare(a.at))
                        .map((note) => (
                          <li key={note.id} className="space-y-1 p-2">
                            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                              <bdi>{note.note}</bdi>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              <bdi>{note.actor}</bdi>
                              {" · "}
                              <time dateTime={note.at}>
                                {date === null
                                  ? note.at.slice(0, 10)
                                  : date.format(new Date(note.at))}
                              </time>
                            </p>
                          </li>
                        ))}
                    </ol>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CustodyBulkActions({
  siteId,
  records,
  onClear,
  open,
  busy,
  words: t,
}: {
  siteId: string;
  records: AssetRecord[];
  onClear: () => void;
  open: CustodyOpener;
  busy: boolean;
  words: CustodyWords;
}) {
  if (records.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card p-3">
      <p className="text-sm text-muted-foreground">
        {t.selected} <Badge variant="outline">{records.length}</Badge>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => open(event.currentTarget, { type: "bulkAssign", siteId, records })}
        >
          {t.bulkAssign}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={(event) => open(event.currentTarget, { type: "bulkReturn", siteId, records })}
        >
          {t.bulkReturn}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>
          {t.clearSelection}
        </Button>
      </div>
    </div>
  );
}

export function CustodyOutcomePanel({
  outcomes,
  records,
  words: t,
}: {
  outcomes: CustodyOutcome[];
  records: AssetRecord[];
  words: CustodyWords;
}) {
  if (outcomes.length === 0) return null;
  const names = new Map(records.map(({ id, name }) => [id, name]));
  return (
    <section aria-label={t.bulkResults} className="space-y-2 rounded-lg border bg-card p-3">
      <h2 role="status" className="text-sm font-semibold">
        {t.bulkResults}
      </h2>
      <ul className="divide-y">
        {outcomes.map((outcome) => (
          <li
            data-custody-outcome-id={outcome.assetId}
            data-custody-outcome={outcome.ok ? "updated" : outcome.error}
            key={outcome.assetId}
            className="flex flex-wrap justify-between gap-x-2 py-1.5 text-sm"
          >
            <bdi className="min-w-0 [overflow-wrap:anywhere]">
              {names.get(outcome.assetId) ?? t.asset}
            </bdi>
            <span className={outcome.ok ? "text-muted-foreground" : "text-destructive"}>
              {outcome.ok ? t.updated : custodyErrorText(outcome.error, t)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
