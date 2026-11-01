"use client";

import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { DeliveryReportReview } from "./DeliveryReportReview";
import type {
  DeliveryObservationView,
  DeliveryRecipientView,
  DeliveryReportsPanelProps,
  DeliveryReviewState,
} from "./deliveryObservationTypes";

function ReportRecipient({
  report,
  recipient,
  targets,
  onReview,
}: Pick<DeliveryReportsPanelProps, "targets" | "onReview"> & {
  report: DeliveryObservationView;
  recipient: DeliveryRecipientView;
}) {
  const t = useAppTranslations("deliveryReports");
  const locale = useLocale();
  const [saved, setSaved] = useState<DeliveryReviewState | null>(null);
  const review =
    saved !== null && saved.revision > recipient.review.revision ? saved : recipient.review;
  const localized = recipient.localizedDiagnostics.find(
    (entry) => entry.languageTag === locale || entry.languageTag.startsWith(`${locale}-`),
  );
  const diagnostic = localized?.text ?? recipient.diagnostic?.text;
  return (
    <div className="space-y-2 border-t border-border/70 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium">{t(`actions.${recipient.action}`)}</p>
          <p className="break-all text-xs text-muted-foreground">
            <bdi dir="ltr">{recipient.finalRecipient.value}</bdi>
            <span aria-hidden="true" className="mx-1.5">
              ·
            </span>
            <bdi dir="ltr" className="font-mono tabular-nums">
              {recipient.status}
            </bdi>
          </p>
        </div>
        <DeliveryReportReview
          report={report}
          recipient={recipient}
          review={review}
          targets={targets}
          onReview={onReview}
          onSaved={setSaved}
        />
      </div>
      {diagnostic !== undefined && (
        <p
          dir="auto"
          className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground"
        >
          {diagnostic}
        </p>
      )}
      {recipient.actionStatus === "conflict" && (
        <p className="text-xs text-destructive">{t("conflictingStatus")}</p>
      )}
      {report.provenance !== "direct" && (
        <p className="text-xs text-muted-foreground">{t(`provenance.${report.provenance}`)}</p>
      )}
      {review.decision === "associated" && review.target !== null && (
        <p className="text-xs text-muted-foreground">
          {t("associated")}
          {" · "}
          <bdi dir="ltr">{review.target.recipient}</bdi>
        </p>
      )}
      {review.decision === "dismissed" && (
        <p className="text-xs text-muted-foreground">{t("dismissed")}</p>
      )}
      {review.decision === "unavailable" && (
        <p className="text-xs text-muted-foreground">{t("unavailable")}</p>
      )}
      {saved !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("saved")}
        </p>
      )}
    </div>
  );
}

/** Owner-only review surface. Server reads and writes must independently enforce ownership. */
export function DeliveryReportsPanel({
  isOwner,
  reports,
  targets,
  onReview,
}: DeliveryReportsPanelProps): React.ReactNode {
  const t = useAppTranslations("deliveryReports");
  const locale = useLocale();
  if (!isOwner || reports.length === 0) return null;
  return (
    <section
      aria-label={t("title")}
      dir={directionForLocale(locale)}
      className="mt-3 rounded-md border border-border bg-muted/20 p-3"
    >
      <div className="mb-2 flex items-center gap-2">
        <ShieldAlert aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <span className="ms-auto rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {t("unverified")}
        </span>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{t("warning")}</p>
      {reports.flatMap((report) =>
        report.recipients.map((recipient) => (
          <ReportRecipient
            key={`${report.id}:${recipient.index}`}
            report={report}
            recipient={recipient}
            targets={targets}
            onReview={onReview}
          />
        )),
      )}
    </section>
  );
}
