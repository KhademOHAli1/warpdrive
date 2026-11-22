"use client";

import { Printer } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
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
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import print from "../../../../inventory/sales/ui/packingSlip.module.css";
import type { BookingHandoverReceipt } from "../contracts";
import type { HandoverWords } from "./messages";
import styles from "./receipt.module.css";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 wrap-anywhere">
      <dt className="font-medium">{label}</dt>
      <dd>
        <bdi>{children}</bdi>
      </dd>
    </div>
  );
}

function ReceiptTable({
  lines,
  title,
  timeZone,
  words: t,
}: {
  lines: BookingHandoverReceipt["items"];
  title: string;
  timeZone: string;
  words: HandoverWords;
}) {
  const preferences = { ...useLocalePreferences(), timeZone };
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      {lines.length === 0 ? (
        <p>{t.noReturns}</p>
      ) : (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-100 text-start text-xs print:min-w-0" aria-label={title}>
            <thead>
              <tr className="border-y">
                {[t.item, t.quantity, t.source, t.destination, t.disposition].map((label) => (
                  <th key={label} className="px-2 py-2 text-start font-semibold" scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: Rows are immutable snapshots and may share a target and disposition.
                  key={`${line.targetId}:${line.disposition}:${index}`}
                  className="border-b align-top print:break-inside-avoid"
                >
                  <th className="wrap-anywhere p-2 text-start font-medium" scope="row">
                    <bdi>{line.name}</bdi>
                    <bdi className="block font-normal">{line.code}</bdi>
                    {line.serial !== null && <bdi className="block font-normal">{line.serial}</bdi>}
                    {line.kitCode !== undefined && (
                      <bdi className="block font-normal">{line.kitCode}</bdi>
                    )}
                  </th>
                  <td className="p-2 tabular-nums">{formatNumber(line.quantity, preferences)}</td>
                  <td className="wrap-anywhere p-2">
                    <bdi>{line.sourceBin ?? "—"}</bdi>
                  </td>
                  <td className="wrap-anywhere p-2">
                    <bdi>{line.destinationBin ?? "—"}</bdi>
                  </td>
                  <td className="wrap-anywhere p-2">{t[line.disposition]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReceiptDocument({
  receipt,
  timeZone,
  words: t,
}: {
  receipt: BookingHandoverReceipt;
  timeZone: string;
  words: HandoverWords;
}) {
  const preferences = { ...useLocalePreferences(), timeZone };
  function date(value: string) {
    return <time dateTime={value}>{formatDateTime(value, preferences)}</time>;
  }
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        <Field label={t.booking}>{receipt.bookingTitle}</Field>
        <Field label={t.site}>{receipt.siteName}</Field>
        <Field label={t.actor}>{receipt.actor}</Field>
        <Field label={t.at}>{date(receipt.at)}</Field>
        <Field label={t.custodian}>{receipt.custodianName ?? "—"}</Field>
        <Field label={t.due}>
          {date(receipt.dueAt)} ({timeZone})
        </Field>
        {receipt.previousDueAt !== null && (
          <Field label={t.previousDue}>{date(receipt.previousDueAt)}</Field>
        )}
      </dl>
      {receipt.note !== null && (
        <p className="wrap-anywhere whitespace-pre-wrap">
          <bdi>{receipt.note}</bdi>
        </p>
      )}
      <ReceiptTable lines={receipt.items} title={t.settled} timeZone={timeZone} words={t} />
      <ReceiptTable lines={receipt.remaining} title={t.remaining} timeZone={timeZone} words={t} />
      <div className="grid grid-cols-2 gap-8 pt-6 text-sm print:break-inside-avoid">
        <p className="border-t pt-2">{t.operatorSignature}</p>
        <p className="border-t pt-2">{t.custodianSignature}</p>
      </div>
    </div>
  );
}

function ReceiptDialog({
  receipt,
  timeZone,
  close,
  restoreFocus,
  words: t,
}: {
  receipt: BookingHandoverReceipt;
  timeZone: string;
  close: () => void;
  restoreFocus: () => void;
  words: HandoverWords;
}) {
  const { locale } = useLocalePreferences();
  const hydrated = useHydrated();
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          data-handover-receipt-dialog
          className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.receipt}</DialogTitle>
            <DialogDescription>{t[receipt.kind]}</DialogDescription>
          </DialogHeader>
          <ReceiptDocument {...{ receipt, timeZone }} words={t} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t.close}
            </Button>
            <Button
              type="button"
              data-handover-print
              onClick={() => window.print()}
              disabled={!hydrated}
            >
              <Printer className="size-4" aria-hidden="true" /> {t.print}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {hydrated &&
        createPortal(
          <article
            data-handover-receipt-print
            className={`${print.printDocument} ${styles.receipt} ${BLOCK_CLASS} ph-no-capture`}
            dir={directionForLocale(locale)}
          >
            <h1 className="mb-1 text-xl font-semibold">{t.receipt}</h1>
            <p className="mb-4 text-sm">{t[receipt.kind]}</p>
            <ReceiptDocument {...{ receipt, timeZone }} words={t} />
          </article>,
          document.body,
        )}
    </>
  );
}

export function HandoverHistory({
  receipts,
  timeZone,
  words: t,
}: {
  receipts: BookingHandoverReceipt[];
  timeZone: string;
  words: HandoverWords;
}) {
  const preferences = { ...useLocalePreferences(), timeZone };
  const [receipt, setReceipt] = useState<BookingHandoverReceipt | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <section className="space-y-2">
      <h3 className="font-semibold">{t.history}</h3>
      {receipts.length === 0 ? (
        <p className="text-muted-foreground">{t.noReceipts}</p>
      ) : (
        <ol className="divide-y rounded-md border">
          {receipts.map((entry) => (
            <li
              key={entry.id}
              data-handover-receipt={entry.id}
              data-handover-receipt-kind={entry.kind}
              className="flex flex-wrap items-center justify-between gap-2 p-2"
            >
              <div className="min-w-0">
                <p className="font-medium">{t[entry.kind]}</p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={entry.at}>{formatDateTime(entry.at, preferences)}</time> ·{" "}
                  <bdi>{entry.actor}</bdi>
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setReceipt(entry);
                }}
              >
                <Printer className="size-4" aria-hidden="true" /> {t.printReceipt}
              </Button>
            </li>
          ))}
        </ol>
      )}
      {receipt !== null && (
        <ReceiptDialog
          {...{ receipt, timeZone }}
          close={() => setReceipt(null)}
          restoreFocus={() => trigger.current?.focus()}
          words={t}
        />
      )}
    </section>
  );
}
