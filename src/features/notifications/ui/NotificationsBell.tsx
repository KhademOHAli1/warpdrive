"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActionError } from "@/components/shell/ActionErrorProvider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { markAllReadAction, markReadAction } from "@/features/notifications/actions";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { NotificationFeedItem } from "@/types/notification";
import { readCsrfToken } from "@/utils/csrfCookie";
import { notificationHref } from "./deepLink";
import { NotificationItem } from "./NotificationItem";
import { useNotificationStream } from "./useNotificationStream";

export function NotificationsBell({ userId }: { userId: string }): React.ReactNode {
  const t = useAppTranslations("notifications");
  const format = useFormatters();
  const { timeZone } = useLocalePreferences();
  const localePending = useLocalePreferencePending();
  useNotificationStream(userId);
  const router = useRouter();
  const utils = trpc.useUtils();
  const reportError = useActionError();
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const countQuery = trpc.notifications.unreadCount.useQuery();
  const feedQuery = trpc.notifications.feed.useQuery(
    { limit: 50, timeZone },
    { enabled: !localePending },
  );

  const feed = feedQuery.data ?? [];
  const unreadCount = countQuery.data ?? 0;
  const today = feed.filter((n) => n.band === "today");
  const earlier = feed.filter((n) => n.band === "earlier");

  async function handleOpen(item: NotificationFeedItem): Promise<void> {
    if (item.readAt === null) {
      const result = await markReadAction({ id: item.id }, readCsrfToken());
      if (result.ok) {
        void utils.notifications.feed.invalidate();
        void utils.notifications.unreadCount.invalidate();
      }
    }
    setOpen(false);
    router.push(notificationHref(item));
  }

  async function handleMarkAll(): Promise<void> {
    setMarkingAll(true);
    const result = await markAllReadAction(readCsrfToken());
    setMarkingAll(false);
    if (result.ok) {
      void utils.notifications.feed.invalidate();
      void utils.notifications.unreadCount.invalidate();
    } else {
      reportError(result.error.id);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("title")}
        className="relative flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Bell aria-hidden className="h-[19px] w-[19px] text-muted-foreground" strokeWidth={1.6} />
        {unreadCount > 0 ? (
          <span className="absolute end-0 top-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-border/70 bg-background px-0.5 text-[9px] font-medium tabular-nums text-action">
            {format.number(unreadCount)}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{t("title")}</span>
          <button
            type="button"
            disabled={markingAll || unreadCount === 0}
            onClick={() => void handleMarkAll()}
            className="text-xs text-link disabled:opacity-40 hover:underline"
          >
            {t("markAllRead")}
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {feed.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : null}

          {today.length > 0 ? (
            <>
              <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("today")}
              </p>
              {today.map((n) => (
                <NotificationItem key={n.id} item={n} onOpen={(item) => void handleOpen(item)} />
              ))}
            </>
          ) : null}

          {earlier.length > 0 ? (
            <>
              <p className="px-3 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("earlier")}
              </p>
              {earlier.map((n) => (
                <NotificationItem key={n.id} item={n} onOpen={(item) => void handleOpen(item)} />
              ))}
            </>
          ) : null}
        </div>

        <div className="border-t">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/activities/calendar");
            }}
            className="w-full px-3 py-2 text-center text-xs text-link hover:underline"
          >
            {t("seeAll")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
