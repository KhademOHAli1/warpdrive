"use client";

import { type FormEvent, useState } from "react";
import { useWorkspaceShell } from "@/components/shell/WorkspaceShellProvider";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Tip } from "@/components/ui/tooltip";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { receiptMessages } from "../admin/receiptMessages";
import { panelClass, WriteMessage } from "../campaigns/ui";
import { useNewsletterRead, useNewsletterWrite } from "../ui/client";
import { type DeliveryStatus, deliveryStates, reviewReferencePattern } from "./contracts";

const labels = {
  en: {
    title: "Delivery receipts",
    rate: "Accepted deliveries per minute",
    choose: "Delivery to review",
    legacy: "Review the campaign’s previous delivery records before starting a new run.",
    revision_changed: "Delivery is paused because the message or template changed.",
    states: [
      "Waiting",
      "Reserved",
      "Submitting",
      "Accepted",
      "Rejected",
      "Outcome unknown",
      "Suppressed",
    ],
  },
  de: {
    title: "Versandbelege",
    rate: "Angenommene Sendungen pro Minute",
    choose: "Zu prüfender Versand",
    legacy: "Prüfen Sie die bisherigen Versandbelege, bevor Sie einen neuen Versand starten.",
    revision_changed: "Der Versand pausiert, weil die Nachricht oder Vorlage geändert wurde.",
    states: [
      "Wartend",
      "Reserviert",
      "Wird gesendet",
      "Angenommen",
      "Abgelehnt",
      "Ergebnis unbekannt",
      "Gesperrt",
    ],
  },
  fa: {
    title: "رسیدهای ارسال",
    rate: "ارسال‌های پذیرفته‌شده در هر دقیقه",
    choose: "ارسال برای بررسی",
    legacy: "پیش از آغاز ارسال جدید، سوابق ارسال قبلی را بررسی کنید.",
    revision_changed: "ارسال به‌دلیل تغییر پیام یا الگو متوقف شده است.",
    states: [
      "در انتظار",
      "رزرو شده",
      "در حال ارسال",
      "پذیرفته",
      "رد شده",
      "نتیجه نامشخص",
      "مسدود شده",
    ],
  },
} as const;

export function DeliveryStatusPanel({ campaignId, live }: { campaignId: number; live: boolean }) {
  const locale = useLocale();
  const m = labels[locale];
  const L = receiptMessages[locale];
  const { campaignCapabilities } = useWorkspaceShell();
  const read = useNewsletterRead<DeliveryStatus>(
    "delivery.status",
    { id: campaignId },
    true,
    live ? 15_000 : undefined,
  );
  const write = useNewsletterWrite();
  const [deliveryId, setDeliveryId] = useState("");
  const [outcome, setOutcome] = useState<"accepted" | "rejected" | "">("");
  const [reference, setReference] = useState("");
  const status = read.data;
  if (status === undefined || (status.hold === "" && Object.keys(status.counts).length === 0)) {
    return null;
  }
  const selected = status.review.find((receipt) => receipt.id === deliveryId);
  const peak = Math.max(1, ...status.rates.map((point) => point.accepted));
  const evidenceReference = reference.trim();
  const rateTime = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
  const rateCount = new Intl.NumberFormat(locale);

  function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      selected === undefined ||
      outcome === "" ||
      !reviewReferencePattern.test(evidenceReference) ||
      write.isPending
    )
      return;
    void write
      .run("delivery.resolve", {
        id: campaignId,
        deliveryId,
        outcome,
        evidenceReference,
        confirmed: true,
      })
      .then(() => {
        setDeliveryId("");
        setOutcome("");
        setReference("");
      })
      .catch(() => undefined);
  }

  return (
    <section className={`${panelClass} grid gap-3 p-4`}>
      <h2 className="text-base font-medium">{m.title}</h2>
      {status.hold !== "" && (
        <p role="status" className="text-sm">
          {m[status.hold]}
        </p>
      )}
      <dl className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {deliveryStates.map((state, index) => {
          const count = status.counts[state];
          return count === undefined ? null : (
            <div key={state} className="flex gap-1.5">
              <dt className="text-muted-foreground">{m.states[index]}</dt>
              <dd>{count}</dd>
            </div>
          );
        })}
      </dl>
      {(live || status.rates.some((point) => point.accepted > 0)) && status.rates.length > 0 && (
        <figure className="grid gap-2 border-t pt-3">
          <figcaption className="text-sm font-medium">{m.rate}</figcaption>
          <ol className="flex h-20 items-end gap-1" aria-label={m.rate}>
            {status.rates.map((point) => {
              const label = `${rateTime.format(new Date(point.minute))} · ${rateCount.format(point.accepted)}`;
              return (
                <li
                  key={point.minute}
                  className="min-h-px min-w-1 flex-1"
                  style={{ height: `${(point.accepted / peak) * 100}%` }}
                  aria-label={label}
                >
                  <Tip label={label}>
                    <span aria-hidden className="block size-full rounded-t-sm bg-action" />
                  </Tip>
                </li>
              );
            })}
          </ol>
        </figure>
      )}
      {campaignCapabilities.operate && status.review.length > 0 && (
        <form className="grid gap-2 border-t pt-3" onSubmit={resolve}>
          <p className="text-sm text-muted-foreground">{L.instructions}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              ariaLabel={m.choose}
              placeholder={m.choose}
              value={deliveryId}
              options={status.review.map((receipt) => ({
                value: receipt.id,
                label: receipt.message_id,
              }))}
              onChange={setDeliveryId}
              disabled={write.isPending}
            />
            <Select
              ariaLabel={L.outcome}
              placeholder={L.outcome}
              value={outcome}
              options={[
                { value: "accepted", label: m.states[3] },
                { value: "rejected", label: m.states[4] },
              ]}
              onChange={(value) => {
                if (value === "accepted" || value === "rejected") setOutcome(value);
              }}
              disabled={write.isPending}
            />
            <Input
              aria-label={L.evidenceId}
              placeholder={L.evidenceId}
              dir="ltr"
              maxLength={36}
              disabled={write.isPending}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
          <Button
            type="submit"
            className="w-fit"
            disabled={
              selected === undefined ||
              outcome === "" ||
              !reviewReferencePattern.test(evidenceReference) ||
              write.isPending
            }
          >
            {L.save}
          </Button>
          <WriteMessage error={write.error} />
        </form>
      )}
    </section>
  );
}
