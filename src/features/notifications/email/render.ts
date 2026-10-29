import { env } from "@/config/env";
import { NOTIFICATION_TYPES } from "@/constants/notificationTypes";
import { createAppTranslator } from "@/features/i18n/catalog";
import { directionForLocale, type Locale } from "@/features/i18n/registry";
import { entityHref } from "@/features/notifications/entityHref";
import type { NotificationRow } from "@/types/notification";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    };
    return map[c] ?? c;
  });
}

// Locale belongs to the recipient. Persisted types, payloads and delivery keys stay unchanged.
export function renderNotificationEmail(
  row: NotificationRow,
  recipientName: string | null,
  locale: Locale = "en",
): { subject: string; text: string; html: string } {
  const t = createAppTranslator(locale, "notifications.email");
  const isolate = (value: string): string => locale === "fa" ? `\u2068${value}\u2069` : value;
  const path = entityHref(row.entityType, row.entityId);
  const link = path !== null ? `${env.BASE_URL}${path}` : env.BASE_URL;
  const recipient = isolate(recipientName === null || recipientName.trim() === "" ? t("recipientFallback") : recipientName);
  const payloadSubject = typeof row.payload.subject === "string" ? row.payload.subject : null;
  const activitySubject = isolate(payloadSubject ?? t("activityFallback"));
  const type = NOTIFICATION_TYPES.find((candidate) => candidate === row.type) ?? "generic";
  const subject = type === "deal_email_received" && payloadSubject !== null
    ? t("deal_email_received.subjectWithTitle", { subject: isolate(payloadSubject) })
    : t(`${type}.subject`, { activitySubject });
  const line = t(`${type}.line`, { recipient, activitySubject });
  const text = `${line}\n\n${t("open", { link: isolate(link) })}`;
  const html = `<div lang="${locale}" dir="${directionForLocale(locale)}"><p>${escapeHtml(line)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t("openAction"))}</a></p></div>`;
  return { subject, text, html };
}
