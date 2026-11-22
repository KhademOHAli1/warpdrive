"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { formatDateTime } from "@/lib/localeFormatting";
import { useHydrated } from "@/lib/useHydrated";
import {
  type BookingAutomationAccess,
  type BookingAutomationNotice,
  bookingAutomationRefreshMs,
} from "./contracts";
import { bookingAutomationTriggerLabels } from "./messages";

const labels = {
  en: {
    title: "Booking notices",
    empty: "No notices for this booking.",
    loading: "Loading booking notices…",
    unavailable: "Booking notices are unavailable.",
    retry: "Reload notices",
    due: "Deadline",
  },
  de: {
    title: "Buchungsmitteilungen",
    empty: "Für diese Buchung gibt es keine Mitteilungen.",
    loading: "Buchungsmitteilungen werden geladen…",
    unavailable: "Die Buchungsmitteilungen sind nicht verfügbar.",
    retry: "Mitteilungen neu laden",
    due: "Frist",
  },
  fa: {
    title: "اعلان‌های رزرو",
    empty: "برای این رزرو اعلانی وجود ندارد.",
    loading: "اعلان‌های رزرو در حال بارگیری هستند…",
    unavailable: "اعلان‌های رزرو در دسترس نیستند.",
    retry: "بارگیری دوبارهٔ اعلان‌ها",
    due: "مهلت",
  },
} as const;

type NoticeRead = BookingAutomationAccess["readNotices"];
type NoticeView =
  | { status: "ready"; notices: BookingAutomationNotice[] }
  | { status: "unavailable" | "transport" };
type LoadedNoticeView = {
  bookingId: string;
  version: number;
  read: NoticeRead;
  attempt: number;
  view: NoticeView;
};

function useBookingAutomationNotices(bookingId: string, version: number, read: NoticeRead) {
  const [loaded, setLoaded] = useState<LoadedNoticeView | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const finish = (view: NoticeView) => {
      if (!controller.signal.aborted) setLoaded({ bookingId, version, read, attempt, view });
    };
    void read(bookingId, controller.signal).then(
      (result) =>
        finish(
          result.ok
            ? {
                status: "ready",
                notices: result.value.filter((notice) => notice.bookingId === bookingId),
              }
            : { status: "unavailable" },
        ),
      () => finish({ status: "transport" }),
    );
    return () => controller.abort();
  }, [attempt, bookingId, read, version]);

  useEffect(() => {
    const refresh = () => setAttempt((previous) => previous + 1);
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(() => {
      if (!document.hidden) refresh();
    }, bookingAutomationRefreshMs);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const view =
    loaded?.bookingId === bookingId &&
    loaded.version === version &&
    loaded.read === read &&
    loaded.attempt === attempt
      ? loaded.view
      : null;
  return { view, retry: () => setAttempt((previous) => previous + 1) };
}

export function BookingAutomationNotices({
  bookingId,
  version,
  timeZone,
  read,
}: {
  bookingId: string;
  version: number;
  timeZone: string;
  read: NoticeRead;
}) {
  const hydrated = useHydrated();
  const preferences = useLocalePreferences();
  const t = labels[preferences.locale];
  const triggerLabels = bookingAutomationTriggerLabels[preferences.locale];
  const format = (date: string) =>
    hydrated ? formatDateTime(date, { ...preferences, timeZone }) : date;
  const { view, retry } = useBookingAutomationNotices(bookingId, version, read);
  const notices = view?.status === "ready" ? view.notices : null;

  return (
    <section data-booking-automation-notices aria-label={t.title} className="space-y-2 p-4">
      <h3 className="font-semibold">{t.title}</h3>
      {view === null && (
        <p role="status" className="text-muted-foreground">
          {t.loading}
        </p>
      )}
      {view !== null && view.status !== "ready" && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-muted-foreground">
            {t.unavailable}
          </p>
          {view.status === "transport" && (
            <Button size="sm" variant="outline" onClick={retry}>
              {t.retry}
            </Button>
          )}
        </div>
      )}
      {notices?.length === 0 && <p className="text-muted-foreground">{t.empty}</p>}
      {notices !== null && notices.length > 0 && (
        <ul className="divide-y rounded-md border">
          {notices.map(({ id, trigger, dueAt, deliveredAt }) => (
            <li
              key={id}
              data-booking-notice={id}
              data-booking-notice-trigger={trigger}
              className="space-y-1 p-2.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <p className="font-medium">{triggerLabels[trigger]}</p>
                <time className="text-xs text-muted-foreground" dateTime={deliveredAt}>
                  {format(deliveredAt)}
                </time>
              </div>
              {dueAt !== null && (
                <p className="text-xs text-muted-foreground">
                  {t.due} <time dateTime={dueAt}>{format(dueAt)}</time>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
