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
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale, type Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import styles from "../../../inventory/sales/ui/packingSlip.module.css";
import type { BookingKind, BookingLine, PullListItem } from "../contracts";

const en = {
  title: "Pull list",
  print: "Print pull list",
  close: "Close",
  booking: "Booking",
  site: "Site",
  due: "Due back",
  custodian: "Custodian",
  item: "Equipment",
  kind: "Requested as",
  quantity: "Quantity",
  bin: "Bin",
  serial: "Serial number",
  definitionVersion: "Kit version",
  empty: "This booking has no equipment.",
  asset: "Exact asset",
  model: "Model",
  kit: "Kit",
  returnable_pool: "Returnable pool",
  consumable_pool: "Consumable pool",
  kitComponent: "Kit component",
};

const messages: Record<Locale, typeof en> = {
  en,
  de: {
    title: "Kommissionierliste",
    print: "Kommissionierliste drucken",
    close: "Schließen",
    booking: "Buchung",
    site: "Standort",
    due: "Rückgabe fällig",
    custodian: "Verantwortliche Person",
    item: "Ausrüstung",
    kind: "Angefragt als",
    quantity: "Menge",
    bin: "Lagerplatz",
    serial: "Seriennummer",
    definitionVersion: "Kit-Version",
    empty: "Für diese Buchung wurde keine Ausrüstung erfasst.",
    asset: "Einzelnes Gerät",
    model: "Modell",
    kit: "Kit",
    returnable_pool: "Mehrwegpool",
    consumable_pool: "Verbrauchsmaterialpool",
    kitComponent: "Kit-Komponente",
  },
  fa: {
    title: "فهرست برداشت",
    print: "چاپ فهرست برداشت",
    close: "بستن",
    booking: "رزرو",
    site: "محل",
    due: "موعد بازگشت",
    custodian: "تحویل‌گیرنده",
    item: "تجهیزات",
    kind: "نوع درخواست",
    quantity: "تعداد",
    bin: "جایگاه انبار",
    serial: "شماره سریال",
    definitionVersion: "نسخه مجموعه",
    empty: "در این رزرو تجهیزاتی ثبت نشده است.",
    asset: "دارایی مشخص",
    model: "مدل",
    kit: "مجموعه",
    returnable_pool: "ذخیره قابل بازگشت",
    consumable_pool: "ذخیره مصرفی",
    kitComponent: "جزء مجموعه",
  },
};

export type BookingPullListData = {
  name: string;
  site: string;
  dueAt: string;
  timeZone: string;
  custodian?: string | null;
  lines: readonly BookingLine[];
};

function usePullListDisplay(timeZone: string) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  return {
    t: messages[preferences.locale],
    date: (value: string) =>
      hydrated ? formatDateTime(value, { ...preferences, timeZone }) : value,
    number: (value: number) => (hydrated ? formatNumber(value, preferences) : String(value)),
  };
}

type PullListDisplay = ReturnType<typeof usePullListDisplay>;

function PullListRow({
  item,
  kind,
  display: { t, number },
  serial = null,
  kitVersion = null,
}: {
  item: PullListItem;
  kind: BookingKind | "kitComponent";
  display: PullListDisplay;
  serial?: string | null;
  kitVersion?: number | null;
}) {
  const component = kind === "kitComponent";
  return (
    <tr data-booking-pull-list-line={kind} className="border-b align-top print:break-inside-avoid">
      <th
        scope="row"
        className={`wrap-anywhere px-2 py-2 text-start font-medium ${component ? "ps-6" : ""}`}
      >
        <bdi className="block">{item.name}</bdi>
        <bdi className="block font-normal">{item.code}</bdi>
        {serial !== null && (
          <span className="block font-normal">
            {t.serial} <bdi>{serial}</bdi>
          </span>
        )}
        {kitVersion !== null && (
          <span className="block font-normal">
            {t.definitionVersion} <bdi>{number(kitVersion)}</bdi>
          </span>
        )}
      </th>
      <td className="px-2 py-2">{t[kind]}</td>
      <td className="px-2 py-2 text-end tabular-nums">
        <bdi>{number(item.quantity)}</bdi>
      </td>
      <td className="wrap-anywhere px-2 py-2">
        <bdi>{item.bin ?? "—"}</bdi>
      </td>
    </tr>
  );
}

function PullListTable({
  lines,
  display,
}: {
  lines: readonly BookingLine[];
  display: PullListDisplay;
}) {
  const { t } = display;
  if (lines.length === 0) return <p>{t.empty}</p>;
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table aria-label={t.title} className="w-full min-w-[28rem] text-start print:min-w-0">
        <thead>
          <tr>
            <th scope="col" className="border-y px-2 py-2 text-start font-semibold">
              {t.item}
            </th>
            <th scope="col" className="border-y px-2 py-2 text-start font-semibold">
              {t.kind}
            </th>
            <th scope="col" className="border-y px-2 py-2 text-end font-semibold">
              {t.quantity}
            </th>
            <th scope="col" className="border-y px-2 py-2 text-start font-semibold">
              {t.bin}
            </th>
          </tr>
        </thead>
        {lines.map((line) => (
          <tbody
            key={`${line.kind}:${line.resourceId}:${line.locationId ?? ""}`}
            className="border-b-2"
          >
            <PullListRow
              item={line}
              kind={line.kind}
              serial={line.serial}
              kitVersion={line.kitDefinitionVersion}
              display={display}
            />
            {line.kind === "kit" &&
              line.contents.map((item, index) => (
                <PullListRow
                  // biome-ignore lint/suspicious/noArrayIndexKey: The immutable snapshot has no component IDs.
                  key={index}
                  item={item}
                  kind="kitComponent"
                  display={display}
                />
              ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function PullListDocument({ list }: { list: BookingPullListData }) {
  const display = usePullListDisplay(list.timeZone);
  const { t, date } = display;
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="wrap-anywhere">
          <dt className="font-semibold">{t.booking}</dt>
          <dd>
            <bdi>{list.name}</bdi>
          </dd>
        </div>
        <div className="wrap-anywhere">
          <dt className="font-semibold">{t.site}</dt>
          <dd>
            <bdi>{list.site}</bdi>
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t.due}</dt>
          <dd>
            <time dateTime={list.dueAt}>
              <bdi>{date(list.dueAt)}</bdi>
            </time>{" "}
            <bdi className="whitespace-nowrap">({list.timeZone})</bdi>
          </dd>
        </div>
        {list.custodian != null && list.custodian.trim() !== "" && (
          <div className="wrap-anywhere">
            <dt className="font-semibold">{t.custodian}</dt>
            <dd>
              <bdi>{list.custodian}</bdi>
            </dd>
          </div>
        )}
      </dl>
      <PullListTable display={display} lines={list.lines} />
    </div>
  );
}

export function BookingPullList({
  list,
  close,
  restoreFocus,
}: {
  list: BookingPullListData;
  close: () => void;
  restoreFocus: () => void;
}) {
  const { locale } = useLocalePreferences();
  const hydrated = useHydrated();
  const t = messages[locale];
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          data-booking-pull-list
          className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.title}</DialogTitle>
            <DialogDescription className="sr-only">{t.item}</DialogDescription>
          </DialogHeader>
          <PullListDocument list={list} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t.close}
            </Button>
            <Button
              type="button"
              data-booking-print
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
            data-booking-pull-list-print
            className={`${styles.printDocument} ${BLOCK_CLASS} ph-no-capture m-8`}
            dir={directionForLocale(locale)}
          >
            <h1 className="mb-5 text-xl font-semibold">{t.title}</h1>
            <PullListDocument list={list} />
          </article>,
          document.body,
        )}
    </>
  );
}
