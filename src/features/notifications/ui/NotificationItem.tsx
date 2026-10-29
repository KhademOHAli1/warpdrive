"use client";

import { useLocale } from "@/features/i18n/LocaleProvider";
import type { NotificationFeedItem } from "@/types/notification";
import { notificationText } from "./notificationText";

export function NotificationItem({
  item,
  onOpen,
}: {
  item: NotificationFeedItem;
  onOpen: (item: NotificationFeedItem) => void;
}): React.ReactNode {
  const unread = item.readAt === null;
  const text = notificationText(item, useLocale());

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={
        unread
          ? "flex w-full items-center gap-2 bg-blue-50 px-3 py-2 text-start hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/50"
          : "flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-accent"
      }
    >
      {unread ? (
        <span data-testid="unread-dot" className="size-2 flex-shrink-0 rounded-full bg-blue-500" />
      ) : null}
      <span className="truncate text-sm">
        <bdi dir="auto">{text}</bdi>
      </span>
    </button>
  );
}
