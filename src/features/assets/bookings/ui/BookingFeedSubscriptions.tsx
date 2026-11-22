"use client";

import { CalendarPlus, Copy } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { formatDateTime } from "@/lib/localeFormatting";
import type { BookingSite } from "../contracts";
import {
  type BookingFeed,
  type BookingFeedCommand,
  type BookingFeedResult,
  bookingFeedSubscriptionPath,
} from "../feedContracts";

const en = {
  heading: "Calendar subscriptions",
  description: "Subscribe in your calendar app to get confirmed bookings for this site.",
  myBookings: "My bookings",
  teamBookings: "Site bookings",
  createSelf: "Create my calendar link",
  createSite: "Create site calendar link",
  revoke: "Revoke link",
  active: "Active",
  revoked: "Revoked",
  empty: "No calendar links for this site.",
  loading: "Loading calendar links…",
  copy: "Copy link",
  url: "Subscription URL",
  keepPrivate: "Anyone with this link can read its calendar. Copy it now and keep it private.",
  copied: "Calendar link copied.",
  select: "Copy the selected link to your calendar app.",
  linkRevoked: "Calendar link revoked.",
  alreadyCreated: "The link was created. Revoke it and create a new link to get a new URL.",
  unavailable: "Calendar subscriptions are unavailable at this site.",
  invalid: "The calendar link request is invalid.",
  conflict: "Calendar links have changed. Close this dialog and open it again.",
  transport: "The request could not be confirmed. Try again.",
};

const words: Record<Locale, typeof en> = {
  en,
  de: {
    heading: "Kalenderabonnements",
    description: "Abonnieren Sie bestätigte Buchungen dieses Standorts in Ihrer Kalender-App.",
    myBookings: "Meine Buchungen",
    teamBookings: "Standortbuchungen",
    createSelf: "Meinen Kalenderlink erstellen",
    createSite: "Standort-Kalenderlink erstellen",
    revoke: "Link widerrufen",
    active: "Aktiv",
    revoked: "Widerrufen",
    empty: "Für diesen Standort gibt es keine Kalenderlinks.",
    loading: "Kalenderlinks werden geladen …",
    copy: "Link kopieren",
    url: "Abonnement-URL",
    keepPrivate:
      "Wer diesen Link hat, kann den Kalender lesen. Kopieren Sie ihn und bewahren Sie ihn vertraulich auf.",
    copied: "Kalenderlink kopiert.",
    select: "Kopieren Sie den markierten Link in Ihre Kalender-App.",
    linkRevoked: "Kalenderlink widerrufen.",
    alreadyCreated:
      "Der Link wurde erstellt. Widerrufen Sie ihn und erstellen Sie einen neuen Link, um eine neue URL zu erhalten.",
    unavailable: "Kalenderabonnements sind für diesen Standort nicht verfügbar.",
    invalid: "Die Anfrage für den Kalenderlink ist ungültig.",
    conflict:
      "Die Kalenderlinks haben sich geändert. Schließen und öffnen Sie dieses Fenster erneut.",
    transport: "Die Anfrage konnte nicht bestätigt werden. Versuchen Sie es erneut.",
  },
  fa: {
    heading: "اشتراک‌های تقویم",
    description: "برای دریافت رزروهای تأییدشده این محل، در برنامه تقویم خود مشترک شوید.",
    myBookings: "رزروهای من",
    teamBookings: "رزروهای محل",
    createSelf: "ساخت پیوند تقویم من",
    createSite: "ساخت پیوند تقویم محل",
    revoke: "لغو پیوند",
    active: "فعال",
    revoked: "لغوشده",
    empty: "این محل هیچ پیوند تقویمی ندارد.",
    loading: "در حال بارگیری پیوندهای تقویم…",
    copy: "کپی پیوند",
    url: "نشانی اشتراک",
    keepPrivate:
      "هر کسی این پیوند را داشته باشد می‌تواند تقویم را بخواند. آن را کپی و محرمانه نگه دارید.",
    copied: "پیوند تقویم کپی شد.",
    select: "پیوند انتخاب‌شده را در برنامه تقویم خود کپی کنید.",
    linkRevoked: "پیوند تقویم لغو شد.",
    alreadyCreated: "پیوند ساخته شد. برای گرفتن نشانی تازه، آن را لغو کنید و یک پیوند تازه بسازید.",
    unavailable: "اشتراک تقویم در این محل در دسترس نیست.",
    invalid: "درخواست پیوند تقویم معتبر نیست.",
    conflict: "پیوندهای تقویم تغییر کرده‌اند. این پنجره را ببندید و دوباره باز کنید.",
    transport: "درخواست تأیید نشد. دوباره تلاش کنید.",
  },
};

export type SubmitBookingFeed = (input: BookingFeedCommand) => Promise<BookingFeedResult>;

type FeedError = Extract<BookingFeedResult, { ok: false }>["error"] | "transport";
type Notice = "copied" | "select" | "linkRevoked" | "alreadyCreated";
type CreateFeed = Extract<BookingFeedCommand, { type: "create" }>;

export function BookingFeedSubscriptions({
  site,
  submit,
}: {
  site: BookingSite;
  submit: SubmitBookingFeed;
}) {
  const preferences = useLocalePreferences();
  const t = words[preferences.locale];
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const createSelf = useRef<HTMLButtonElement>(null);
  const active = useRef(false);
  const retry = useRef<CreateFeed | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [feeds, setFeeds] = useState<BookingFeed[] | null>(null);
  const [link, setLink] = useState<{ feedId: string; url: string } | null>(null);
  const [error, setError] = useState<FeedError | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function run(command: BookingFeedCommand) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    if (command.type === "create") retry.current = command;
    try {
      const result = await submit(command);
      if (command.type === "create") retry.current = null;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFeeds(result.feeds);
      if (result.created !== null) {
        const { id, secret } = result.created;
        const path = bookingFeedSubscriptionPath(id, secret);
        setLink({ feedId: id, url: new URL(path, window.location.origin).href });
      } else if (command.type === "create") {
        setLink(null);
        setNotice("alreadyCreated");
      } else if (command.type === "revoke") {
        setLink((current) => (current?.feedId === command.feedId ? null : current));
        setNotice("linkRevoked");
        requestAnimationFrame(() => createSelf.current?.focus());
      }
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  function toggle(next: boolean) {
    if (active.current) return;
    setOpen(next);
    if (next) void run({ type: "list", siteId: site.id });
    else {
      setFeeds(null);
      setLink(null);
      setError(null);
      setNotice(null);
    }
  }

  function create(scope: CreateFeed["scope"]) {
    const prior = retry.current;
    const requestId = prior?.scope === scope ? prior.requestId : crypto.randomUUID();
    void run({ type: "create", siteId: site.id, scope, requestId });
  }

  async function copy() {
    if (link === null) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setNotice("copied");
    } catch {
      input.current?.focus();
      input.current?.select();
      setNotice("select");
    }
  }

  const options = { ...preferences, timeZone: site.policy.timeZone };
  return (
    <Dialog open={open} onOpenChange={toggle}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <CalendarPlus size={15} aria-hidden="true" /> {t.heading}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={`${BLOCK_CLASS} ph-no-capture max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl`}
        aria-busy={pending}
      >
        <DialogHeader>
          <DialogTitle>{t.heading}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button
            ref={createSelf}
            size="sm"
            disabled={pending || feeds === null}
            onClick={() => create("self")}
          >
            {t.createSelf}
          </Button>
          {site.canConfigure && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending || feeds === null}
              onClick={() => create("site")}
            >
              {t.createSite}
            </Button>
          )}
        </div>
        {link !== null && (
          <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">{t.keepPrivate}</p>
            <label htmlFor={inputId} className="text-sm font-medium">
              {t.url}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={inputId}
                ref={input}
                value={link.url}
                dir="ltr"
                readOnly
                spellCheck={false}
                autoComplete="off"
                className="min-w-0 flex-1 font-mono text-xs"
              />
              <Button size="sm" variant="outline" onClick={() => void copy()}>
                <Copy size={14} aria-hidden="true" /> {t.copy}
              </Button>
            </div>
          </div>
        )}
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t[error]}
          </p>
        )}
        {notice !== null && (
          <p role="status" className="text-sm text-muted-foreground">
            {t[notice]}
          </p>
        )}
        {feeds === null && pending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t.loading}
          </p>
        ) : null}
        {feeds !== null &&
          (feeds.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.empty}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {feeds.map((feed) => (
                <li
                  key={feed.id}
                  data-booking-calendar-feed={feed.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-sm"
                >
                  <div>
                    <p className="flex flex-wrap items-center gap-1.5 font-medium">
                      {feed.scope === "site" ? t.teamBookings : t.myBookings}
                      <Badge variant="outline">
                        {feed.revokedAt === null ? t.active : t.revoked}
                      </Badge>
                    </p>
                    <time className="text-xs text-muted-foreground" dateTime={feed.createdAt}>
                      {formatDateTime(feed.createdAt, options)}
                    </time>
                  </div>
                  {feed.revokedAt === null && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void run({ type: "revoke", siteId: site.id, feedId: feed.id })}
                    >
                      {t.revoke}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </DialogContent>
    </Dialog>
  );
}
