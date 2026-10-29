import { ERROR_IDS } from "@/constants/errorIds";
import { messagesForLocale } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

// Domain-neutral user-facing copy for a failed action (any feature: settings, leads, email,
// contacts) that would otherwise fail silently. Keyed by AppError id (src/constants/errorIds.ts);
// an unmapped id or a rejected promise with no id falls back to the generic entry. The
// deal-workspace has its own richer, deal-specific mapper (dealActionError.ts); this one is the
// app-wide default surfaced by ActionErrorProvider.
export interface ActionErrorContent {
  title: string;
  body: string;
}

type ErrorReason = keyof ReturnType<typeof messagesForLocale>["shell"]["errors"];

const REASONS: Record<string, ErrorReason> = {
  [ERROR_IDS.PERM_DENIED]: "permission",
  [ERROR_IDS.AUTH_SESSION_DEAD]: "session",
  E_AUTH_CSRF: "csrf",
  [ERROR_IDS.LEAD_CONVERT_NO_PIPELINE]: "noPipeline",
  [ERROR_IDS.LEAD_ALREADY_CONVERTED]: "converted",
  [ERROR_IDS.DEAL_FILTER_INVALID]: "invalidFilter",
  [ERROR_IDS.DEAL_BULK_ARCHIVE_PARTIAL]: "partialArchive",
  [ERROR_IDS.DEAL_BULK_STAGE_PARTIAL]: "partialStage",
};

export function actionErrorContent(errorId?: string, locale: Locale = "en"): ActionErrorContent {
  const reason = errorId === undefined ? "generic" : (REASONS[errorId] ?? "generic");
  return messagesForLocale(locale).shell.errors[reason];
}
