import { NOTIFY_STRINGS } from "@/constants/notifyStrings";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import type { NotificationFeedItem } from "@/types/notification";

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function notificationText(item: NotificationFeedItem, locale: Locale): string {
  const t = createAppTranslator(locale, "notifications.items");
  const isolate = (value: string): string => (locale === "fa" ? `\u2068${value}\u2069` : value);
  const payload = item.payload;
  switch (item.type) {
    case "mention": {
      const title = text(payload.title);
      return title === "" ? t("mention") : t("mentionTitle", { title: isolate(title) });
    }
    case "activity_assigned":
      return t("activity_assigned", { subject: isolate(text(payload.subject)) });
    case "activity_reminder":
      return t("activity_reminder", { subject: isolate(text(payload.subject)) });
    case "deal_followed_update": {
      const raw = text(payload.changeSummary);
      const summary =
        raw === NOTIFY_STRINGS.dealUpdated
          ? t("updated")
          : raw === NOTIFY_STRINGS.dealMoved
            ? t("moved")
            : raw || t("followedFallback");
      return t("deal_followed_update", { summary: isolate(summary) });
    }
    case "deal_email_received":
      return t("deal_email_received", {
        subject: isolate(text(payload.subject) || t("emailFallback")),
      });
    case "email_open":
      return t("email_open");
    case "email_click":
      return t("email_click");
    case "deal_won":
      return t("deal_won");
    case "deal_lost":
      return t("deal_lost");
    case "comment_reply":
      return t("comment_reply");
  }
}
