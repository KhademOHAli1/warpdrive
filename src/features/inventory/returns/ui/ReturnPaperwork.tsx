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
import styles from "../../sales/ui/packingSlip.module.css";
import type { ReturnDetail, ReturnSource } from "../contracts";
import { returnPartLabel, useReturnDisplay } from "./display";
import type { ReturnMessages } from "./messages";

type DocumentProps = {
  detail: ReturnDetail;
  source: ReturnSource | null;
  site: string;
  t: ReturnMessages;
};

function ReturnDocument({ detail, source, site, t }: DocumentProps) {
  const f = useReturnDisplay();
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="font-semibold">{t.reference}</dt>
          <dd>
            <bdi>{detail.reference}</bdi>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.shipmentRef}</dt>
          <dd>
            <bdi>{detail.shipmentReference}</bdi>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.site}</dt>
          <dd>
            <bdi>{site}</bdi>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.status}</dt>
          <dd>{t[detail.status]}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t.created}</dt>
          <dd>
            <time dateTime={detail.createdAt}>{f.date(detail.createdAt)}</time>
          </dd>
        </div>
        {source?.customerName != null && (
          <div>
            <dt className="font-semibold">{t.customer}</dt>
            <dd>
              <bdi>{source.customerName}</bdi>
            </dd>
          </div>
        )}
        {detail.note !== null && (
          <div className="sm:col-span-2">
            <dt className="font-semibold">{t.note}</dt>
            <dd>
              <bdi>{detail.note}</bdi>
            </dd>
          </div>
        )}
      </dl>
      <div className="overflow-x-auto print:overflow-visible">
        <table aria-label={t.caseItems} className="w-full min-w-[32rem] text-start print:min-w-0">
          <thead>
            <tr>
              {[t.part, t.requested, t.received, t.reason].map((label) => (
                <th scope="col" key={label} className="border-y px-2 py-2 text-start font-semibold">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((line) => (
              <tr key={line.id} className="border-b align-top print:break-inside-avoid">
                <th scope="row" className="break-words px-2 py-2 text-start font-medium">
                  <bdi>{returnPartLabel(line)}</bdi>
                  <bdi className="block font-normal">{line.name}</bdi>
                </th>
                <td className="px-2 py-2">{f.quantity(line.quantity)}</td>
                <td className="px-2 py-2">{f.quantity(line.received)}</td>
                <td className="break-words px-2 py-2">
                  <bdi>{line.reason}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {detail.charges !== null && detail.currency !== null && detail.charges.length > 0 && (
        <dl className="space-y-1 border-t pt-3">
          {detail.charges.map(({ label, amount }) => (
            <div className="flex justify-between gap-4" key={label}>
              <dt>
                <bdi>{label}</bdi>
              </dt>
              <dd>
                <bdi>{f.amount(amount, detail.currency ?? "")}</bdi>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function ReturnPaperwork({
  close,
  restoreFocus,
  ...documentProps
}: DocumentProps & {
  close: () => void;
  restoreFocus: () => void;
}) {
  const { detail, t } = documentProps;
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
          data-return-paperwork
          className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.returnPaperwork}</DialogTitle>
            <DialogDescription>
              <bdi>{detail.reference}</bdi>
            </DialogDescription>
          </DialogHeader>
          <ReturnDocument {...documentProps} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t.close}
            </Button>
            <Button
              type="button"
              data-return-action="print"
              disabled={!hydrated}
              onClick={() => window.print()}
            >
              <Printer className="size-4" aria-hidden="true" />
              {t.print}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {hydrated &&
        createPortal(
          <article
            className={`${styles.printDocument} ${BLOCK_CLASS} ph-no-capture m-8`}
            dir={locale === "fa" ? "rtl" : "ltr"}
          >
            <h1 className="mb-5 text-xl font-semibold">{t.returnPaperwork}</h1>
            <ReturnDocument {...documentProps} />
          </article>,
          document.body,
        )}
    </>
  );
}
