import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import { operationalNoticeSchema } from "./operationalContracts";

/** Rendering consumes the same strict, non-PII envelope as persistence and feed authorization. */
export function operationalNoticeText(payload: unknown, locale: Locale): string {
  const t = createAppTranslator(locale, "notifications.operations");
  const parsed = operationalNoticeSchema.safeParse(payload);
  if (!parsed.success) return t("unavailable");
  const notice = parsed.data;
  const message = t(notice.reason);
  return notice.count === 0 ? message : `${message} · ${t("eventCount", { count: notice.count })}`;
}
