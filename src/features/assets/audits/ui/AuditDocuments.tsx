"use client";

import { Download, Printer } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
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
import { escapeCsv } from "@/features/import/csvSafe";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import print from "../../../inventory/sales/ui/packingSlip.module.css";
import type {
  EquipmentAuditDetail,
  EquipmentAuditEvent,
  EquipmentAuditEvidence,
  EquipmentAuditProgress,
} from "../contracts";
import styles from "./auditReport.module.css";
import { equipmentLabel, placementLabel } from "./auditView";
import type { AuditWords } from "./messages";

export function AuditTime({ value }: { value: string }) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  return <time dateTime={value}>{hydrated ? formatDateTime(value, preferences) : value}</time>;
}

export function AuditProgress({
  progress,
  completed,
  words: t,
}: {
  progress: EquipmentAuditProgress;
  completed: boolean;
  words: AuditWords;
}) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  const metrics = [
    { id: "expected", label: t.expected, value: progress.expectedRows },
    { id: "found", label: t.found, value: progress.foundRows },
    {
      id: completed ? "missing" : "outstanding",
      label: completed ? t.missing : t.outstanding,
      value: completed ? progress.missingRows : progress.outstandingRows,
    },
    { id: "unexpected", label: t.unexpected, value: progress.unexpectedRows },
    { id: "expectedUnits", label: t.expectedUnits, value: progress.expectedUnits },
    { id: "foundUnits", label: t.foundUnits, value: progress.foundUnits },
    { id: "unexpectedUnits", label: t.unexpectedUnits, value: progress.unexpectedUnits },
    ...(completed
      ? [{ id: "missingUnits", label: t.missingUnits, value: progress.missingUnits }]
      : []),
  ];
  return (
    <dl
      data-audit-progress
      className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border p-3 sm:grid-cols-4"
    >
      {metrics.map(({ id, label, value }) => (
        <div key={id} data-audit-metric={id}>
          <dt className="text-xs text-muted-foreground print:text-inherit">{label}</dt>
          <dd className="font-semibold tabular-nums">
            {hydrated ? formatNumber(value, preferences) : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditActivity({
  activity,
  words: t,
}: {
  activity: EquipmentAuditEvent[];
  words: AuditWords;
}) {
  return (
    <section data-audit-activity className="space-y-2">
      <h3 className="font-semibold">{t.activity}</h3>
      {activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noActivity}</p>
      ) : (
        <ol className="divide-y rounded-md border">
          {activity.map((event) => (
            <li key={event.id} data-audit-event={event.kind} className="space-y-1 p-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-medium">
                  <bdi>{t[event.kind]}</bdi>
                </p>
                <span className="text-xs text-muted-foreground">
                  <AuditTime value={event.at} />
                </span>
              </div>
              <p className="wrap-anywhere text-xs text-muted-foreground">
                <bdi>{event.actor}</bdi>
                {event.rowName !== null && (
                  <>
                    {" "}
                    · <bdi>{event.rowName}</bdi>
                  </>
                )}
              </p>
              {(event.before !== null || event.after !== null) && (
                <p className="flex flex-wrap gap-2 text-xs">
                  <span>
                    {t.before} <bdi>{event.before ?? "—"}</bdi>
                  </span>
                  <span>
                    {t.after} <bdi>{event.after ?? "—"}</bdi>
                  </span>
                </p>
              )}
              {event.note !== null && (
                <p className="wrap-anywhere whitespace-pre-wrap">
                  <bdi>{event.note}</bdi>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function evidenceUrl(raw: string) {
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  if (typeof window === "undefined" || !raw.startsWith("blob:")) return null;
  try {
    return new URL(raw).origin === window.location.origin ? raw : null;
  } catch {
    return null;
  }
}

function EvidencePhoto({ item, words: t }: { item: EquipmentAuditEvidence; words: AuditWords }) {
  const href = evidenceUrl(item.href);
  return (
    <figure
      data-audit-photo={item.id}
      className="min-w-0 space-y-1 rounded-md border p-2 print:break-inside-avoid"
    >
      {href !== null && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="relative block h-32 rounded-sm bg-muted print:h-24"
          aria-label={`${t.openPhoto} · ${item.name}`}
        >
          <Image
            unoptimized
            fill
            loading="eager"
            sizes="20rem"
            src={href}
            alt={item.name}
            className="object-contain"
          />
        </a>
      )}
      <figcaption className="wrap-anywhere text-xs">
        <bdi className="block font-medium">{item.name}</bdi>
        <span>
          {t[item.source]} · <bdi>{item.actor}</bdi> · <AuditTime value={item.at} />
        </span>
      </figcaption>
    </figure>
  );
}

export function AuditEvidence({
  detail,
  words: t,
}: {
  detail: EquipmentAuditDetail;
  words: AuditWords;
}) {
  return (
    <section data-audit-evidence className="space-y-2">
      <h3 className="font-semibold">{t.evidence}</h3>
      {detail.evidence.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noEvidence}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {detail.evidence.map((item) => (
            <div key={item.id} className="min-w-0 space-y-1">
              {item.rowId !== null && (
                <p className="wrap-anywhere text-xs">
                  <bdi>
                    {detail.rows.find(({ id }) => id === item.rowId)?.target?.name ?? t.equipment}
                  </bdi>
                </p>
              )}
              <EvidencePhoto item={item} words={t} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function downloadActivity(detail: EquipmentAuditDetail, t: AuditWords) {
  const header = [t.recorded, t.actor, t.action, t.equipment, t.before, t.after, t.note];
  const rows = detail.activity.map((event) => [
    event.at,
    event.actor,
    t[event.kind],
    event.rowName ?? "",
    String(event.before ?? ""),
    String(event.after ?? ""),
    event.note ?? "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = `equipment-audit-${detail.id}-activity.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

function ReportBody({ detail, words: t }: { detail: EquipmentAuditDetail; words: AuditWords }) {
  const withNotes = detail.activity.filter(
    (event) =>
      event.note !== null &&
      (event.kind === "note" || event.kind === "completed" || event.kind === "reviewed"),
  );
  return (
    <article className="min-w-0 space-y-4 text-sm">
      <div className="space-y-1">
        <h3 className="wrap-anywhere text-lg font-semibold">
          <bdi>{detail.title}</bdi>
        </h3>
        <p>
          <bdi>{detail.siteName}</bdi> · {t[detail.status]}
        </p>
        {detail.completedAt !== null && (
          <p>
            {t.completed} <AuditTime value={detail.completedAt} />
          </p>
        )}
        {detail.reviewedAt !== null && (
          <p>
            {t.reviewed} <AuditTime value={detail.reviewedAt} />
          </p>
        )}
      </div>
      <AuditProgress
        progress={detail.progress}
        completed={detail.status === "completed"}
        words={t}
      />
      <div className="overflow-x-auto print:overflow-visible">
        <table
          aria-label={t.findings}
          className="w-full min-w-100 border-collapse text-xs print:min-w-0"
        >
          <thead className="border-b text-start">
            <tr>
              {[t.equipment, t.expectedPlacement, t.expected, t.quantity, t.findings].map(
                (column) => (
                  <th key={column} scope="col" className="px-2 py-2 text-start">
                    {column}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {detail.rows.map((row) => (
              <tr key={row.id} className="border-b align-top print:break-inside-avoid">
                <th className="wrap-anywhere p-2 text-start font-medium" scope="row">
                  <bdi>{equipmentLabel(row, t)}</bdi>
                </th>
                <td className="wrap-anywhere p-2">
                  <bdi>{placementLabel(row, t)}</bdi>
                </td>
                <td className="p-2">{row.expected ?? "—"}</td>
                <td className="p-2">{row.counted ?? "—"}</td>
                <td className="p-2">{t[row.result]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {withNotes.length > 0 && <AuditActivity activity={withNotes} words={t} />}
      {detail.evidence.length > 0 && <AuditEvidence detail={detail} words={t} />}
    </article>
  );
}

function AuditPrintDialog({
  detail,
  words: t,
  close,
  restoreFocus,
}: {
  detail: EquipmentAuditDetail;
  words: AuditWords;
  close: () => void;
  restoreFocus: () => void;
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
          data-audit-report
          className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-3xl`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t.report}</DialogTitle>
            <DialogDescription className="sr-only">{t.findings}</DialogDescription>
          </DialogHeader>
          <ReportBody detail={detail} words={t} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t.close}
            </Button>
            <Button
              type="button"
              data-audit-print-submit
              disabled={!hydrated}
              onClick={() => window.print()}
            >
              <Printer className="size-4" aria-hidden="true" /> {t.print}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {hydrated &&
        createPortal(
          <div
            data-audit-report-print
            dir={directionForLocale(locale)}
            className={`${print.printDocument} ${styles.report} ${BLOCK_CLASS} ph-no-capture`}
          >
            <h1 className="mb-4 text-xl font-semibold">{t.report}</h1>
            <ReportBody detail={detail} words={t} />
          </div>,
          document.body,
        )}
    </>
  );
}

export function AuditDocuments({
  detail,
  words: t,
}: {
  detail: EquipmentAuditDetail;
  words: AuditWords;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {(detail.status === "completed" || detail.status === "cancelled") && (
        <Button
          size="sm"
          variant="outline"
          data-audit-print
          ref={trigger}
          onClick={() => setOpen(true)}
        >
          <Printer className="size-4" aria-hidden="true" /> {t.printReport}
        </Button>
      )}
      <Button
        size="sm"
        variant="outline"
        data-audit-export
        disabled={detail.activity.length === 0}
        onClick={() => downloadActivity(detail, t)}
      >
        <Download className="size-4" aria-hidden="true" /> {t.exportCsv}
      </Button>
      {open && (
        <AuditPrintDialog
          detail={detail}
          words={t}
          close={() => setOpen(false)}
          restoreFocus={() => trigger.current?.focus()}
        />
      )}
    </div>
  );
}
