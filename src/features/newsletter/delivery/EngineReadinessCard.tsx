"use client";

import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useNewsletterRead } from "../ui/client";
import type { EngineReadiness } from "./readiness";

const copy = {
  en: {
    title: "Delivery readiness",
    refresh: "Check again",
    unavailable: "Could not check the engine.",
    loading: "Checking engine…",
    limits: "Effective limits",
    clamped: "The engine applied its configured safety limits.",
    database: "Database",
    scheduler: "Scheduler",
    relay: "Mail relay",
    media: "Media storage",
    feedback: "SES feedback",
    ready: "Ready",
    starting: "Starting",
    stale: "No recent scan",
    passive: "Passive",
    unconfigured: "Unconfigured",
    unchecked: "Unchecked",
    migration_required: "Migration required",
    disabled: "Disabled",
    configured: "Awaiting confirmation",
    confirmed: "Confirmed",
    workers: "workers",
    rate: "messages per second",
    batch: "per batch",
  },
  de: {
    title: "Versandbereitschaft",
    refresh: "Erneut prüfen",
    unavailable: "Der Versanddienst konnte nicht geprüft werden.",
    loading: "Versanddienst wird geprüft…",
    limits: "Wirksame Grenzen",
    clamped: "Der Versanddienst hat seine Sicherheitsgrenzen angewendet.",
    database: "Datenbank",
    scheduler: "Zeitplanung",
    relay: "Mailserver",
    media: "Medienspeicher",
    feedback: "SES-Rückmeldungen",
    ready: "Bereit",
    starting: "Startet",
    stale: "Keine aktuelle Prüfung",
    passive: "Passiv",
    unconfigured: "Nicht eingerichtet",
    unchecked: "Ungeprüft",
    migration_required: "Migration erforderlich",
    disabled: "Deaktiviert",
    configured: "Bestätigung ausstehend",
    confirmed: "Bestätigt",
    workers: "Prozesse",
    rate: "Nachrichten pro Sekunde",
    batch: "pro Stapel",
  },
  fa: {
    title: "آمادگی ارسال",
    refresh: "بررسی دوباره",
    unavailable: "بررسی سرویس ارسال ممکن نبود.",
    loading: "در حال بررسی سرویس…",
    limits: "محدودیت‌های مؤثر",
    clamped: "سرویس ارسال محدودیت‌های ایمنی خود را اعمال کرد.",
    database: "پایگاه داده",
    scheduler: "زمان‌بندی",
    relay: "سرور ایمیل",
    media: "فضای ذخیره رسانه",
    feedback: "بازخورد SES",
    ready: "آماده",
    starting: "در حال راه‌اندازی",
    stale: "بدون بررسی اخیر",
    passive: "غیرفعال",
    unconfigured: "تنظیم نشده",
    unchecked: "بررسی نشده",
    migration_required: "نیازمند مهاجرت",
    disabled: "غیرفعال",
    configured: "در انتظار تأیید",
    confirmed: "تأیید شده",
    workers: "پردازش",
    rate: "پیام در ثانیه",
    batch: "در هر دسته",
  },
} as const;

const checks = ["database", "scheduler", "relay", "media", "feedback"] as const;

export function EngineReadinessCard() {
  const L = copy[useLocale()];
  const read = useNewsletterRead<EngineReadiness>("admin.readiness");
  const data = read.data;
  return (
    <SettingsCard>
      <SettingsCardHeader title={L.title} />
      <SettingsCardBody className="space-y-3 text-sm">
        {data === undefined ? (
          <p role={read.isError ? "alert" : "status"}>{read.isError ? L.unavailable : L.loading}</p>
        ) : (
          <>
            <dl className="grid gap-2 sm:grid-cols-2">
              {checks.map((check) => (
                <div
                  key={check}
                  className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-2"
                >
                  <dt>{L[check]}</dt>
                  <dd>
                    <Badge
                      variant={
                        data[check].status === "ready" || data[check].status === "confirmed"
                          ? "success"
                          : "secondary"
                      }
                    >
                      {L[data[check].status]}
                    </Badge>
                  </dd>
                </div>
              ))}
            </dl>
            <p>
              {L.limits} · {data.limits.workers} {L.workers} · {data.limits.messagesPerSecond}{" "}
              {L.rate} · {data.limits.batchSize} {L.batch}
            </p>
            {data.limits.clamped && <p className="text-muted-foreground">{L.clamped}</p>}
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={read.isFetching}
          onClick={() => void read.refetch()}
        >
          {L.refresh}
        </Button>
      </SettingsCardBody>
    </SettingsCard>
  );
}
