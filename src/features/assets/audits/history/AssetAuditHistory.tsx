"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime, formatNumber } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import { type AuditWords, auditMessages } from "../ui/messages";
import type {
  AssetAuditFinding,
  AssetAuditHistoryAccess,
  AssetAuditHistoryResult,
} from "./contracts";

const messages = {
  en: {
    title: "Audit findings",
    empty: "No accessible audit findings for this equipment.",
    unavailable: "Audit findings are unavailable.",
    withdrawn: "Withdrawn",
    truncated: "Showing the most recent audits.",
  },
  de: {
    title: "Prüfergebnisse",
    empty: "Für dieses Gerät sind keine zugänglichen Prüfergebnisse vorhanden.",
    unavailable: "Die Prüfergebnisse sind nicht verfügbar.",
    withdrawn: "Zurückgenommen",
    truncated: "Die neuesten Prüfungen werden angezeigt.",
  },
  fa: {
    title: "یافته‌های بازرسی",
    empty: "یافتهٔ قابل دسترسی برای این تجهیز وجود ندارد.",
    unavailable: "یافته‌های بازرسی در دسترس نیستند.",
    withdrawn: "پس گرفته‌شده",
    truncated: "جدیدترین بازرسی‌ها نمایش داده می‌شوند.",
  },
} as const;

type QueryResult = AssetAuditHistoryResult | { ok: false; error: "transport" };
type Loaded = {
  assetId: string;
  read: AssetAuditHistoryAccess;
  attempt: number;
  result: QueryResult;
};
type Display = { time: (at: string) => string; number: (value: number | null) => string };

function useAuditHistory(assetId: string, read: AssetAuditHistoryAccess) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const finish = (result: QueryResult) => {
      if (!controller.signal.aborted) setLoaded({ assetId, read, attempt, result });
    };
    void read(assetId, controller.signal).then(finish, () =>
      finish({ ok: false, error: "transport" }),
    );
    return () => controller.abort();
  }, [assetId, read, attempt]);
  const result =
    loaded?.assetId === assetId && loaded.read === read && loaded.attempt === attempt
      ? loaded.result
      : null;
  return { result, retry: () => setAttempt((previous) => previous + 1) };
}

function Finding({
  finding,
  words: t,
  display,
  withdrawn,
}: {
  finding: AssetAuditFinding;
  words: AuditWords;
  display: Display;
  withdrawn: string;
}) {
  return (
    <li data-asset-audit-finding={finding.id} className="space-y-2 p-2.5">
      <div className="flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0 wrap-anywhere">
          <p>
            <bdi dir="auto">{finding.name}</bdi>
          </p>
          <p className="text-xs text-muted-foreground">
            <bdi dir="auto">{finding.placement.label ?? t[finding.placement.kind]}</bdi>
          </p>
          {finding.serial !== null && (
            <p className="text-xs text-muted-foreground">
              <bdi dir="auto">{finding.serial}</bdi>
            </p>
          )}
        </div>
        <Badge
          variant={finding.result === "missing" ? "destructive" : "outline"}
          data-asset-audit-result={finding.result}
        >
          {finding.result === "withdrawn" ? withdrawn : t[finding.result]}
        </Badge>
      </div>
      <dl className="flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums">
        <div>
          <dt className="text-muted-foreground">{t.expectedUnits}</dt>
          <dd data-asset-audit-expected={finding.expected ?? undefined}>
            {display.number(finding.expected)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t.countedUnits}</dt>
          <dd data-asset-audit-counted={finding.counted ?? undefined}>
            {display.number(finding.counted)}
          </dd>
        </div>
      </dl>
      {finding.activity.length > 0 && (
        <ol aria-label={t.activity} className="space-y-2 border-s ps-2.5 text-xs">
          {finding.activity.map((event) => (
            <li
              key={event.id}
              data-asset-audit-event={event.kind}
              className="space-y-1 wrap-anywhere"
            >
              <p className="font-medium">{t[event.kind]}</p>
              <p className="text-muted-foreground">
                <bdi dir="auto">{event.actor}</bdi>
                {" · "}
                <time dateTime={event.at}>{display.time(event.at)}</time>
              </p>
              <dl className="flex flex-wrap gap-x-2 gap-y-1 tabular-nums">
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">{t.before}</dt>
                  <dd>{display.number(event.before)}</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">{t.after}</dt>
                  <dd>{display.number(event.after)}</dd>
                </div>
              </dl>
              {event.note !== null && (
                <p className="whitespace-pre-wrap">
                  <bdi dir="auto">{event.note}</bdi>
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function AssetAuditHistory({
  assetId,
  read,
}: {
  assetId: string;
  read: AssetAuditHistoryAccess;
}) {
  const preferences = useLocalePreferences();
  const hydrated = useHydrated();
  const t = auditMessages[preferences.locale];
  const labels = messages[preferences.locale];
  const { result, retry } = useAuditHistory(assetId, read);
  const display: Display = {
    time: (at) => (hydrated ? formatDateTime(at, preferences) : at),
    number: (value) =>
      value === null ? "—" : hydrated ? formatNumber(value, preferences) : String(value),
  };

  return (
    <section data-asset-audit-history aria-label={labels.title} className="min-w-0 space-y-2 p-4">
      <h3 className="font-semibold">{labels.title}</h3>
      {result === null && (
        <p role="status" className="text-muted-foreground">
          {t.loading}
        </p>
      )}
      {result?.ok === false && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-muted-foreground">
            {result.error === "unavailable" ? labels.unavailable : t.transport}
          </p>
          {result.error === "transport" && (
            <Button variant="outline" size="sm" onClick={retry}>
              {t.refresh}
            </Button>
          )}
        </div>
      )}
      {result?.ok === true &&
        (result.entries.length === 0 ? (
          <p className="text-muted-foreground">{labels.empty}</p>
        ) : (
          <ol className="space-y-3">
            {result.entries.map((entry) => (
              <li
                key={entry.auditId}
                data-asset-audit-entry={entry.auditId}
                className="min-w-0 space-y-2"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <h4 className="min-w-0 font-medium wrap-anywhere">
                    <Link
                      href={{ pathname: "/assets/audits", query: { auditId: entry.auditId } }}
                      prefetch={false}
                      className="rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <bdi dir="auto">{entry.title}</bdi>
                    </Link>
                  </h4>
                  <Badge variant="outline">{t[entry.archived ? "archived" : entry.status]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={entry.at}>{display.time(entry.at)}</time>
                </p>
                <ul className="divide-y rounded-md border">
                  {entry.findings.map((finding) => (
                    <Finding
                      key={finding.id}
                      finding={finding}
                      words={t}
                      display={display}
                      withdrawn={labels.withdrawn}
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        ))}
      {result?.ok === true && result.truncated === true && (
        <p className="text-xs text-muted-foreground">{labels.truncated}</p>
      )}
    </section>
  );
}
