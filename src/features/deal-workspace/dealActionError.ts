import { ERROR_IDS } from "@/constants/errorIds";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
export interface DealActionErrorContent {
  title: string;
  body: string;
}
export function dealActionErrorContent(
  errorId?: string,
  locale: Locale = "en",
): DealActionErrorContent {
  const t = createAppTranslator(locale, "sales");
  const generic = { title: t("computed.changeFailedTitle"), body: t("computed.changeFailedBody") };
  const content: Record<string, DealActionErrorContent> = {
    [ERROR_IDS.PERM_DENIED]: {
      title: t("computed.permissionTitle"),
      body: t("computed.permissionBody"),
    },
    [ERROR_IDS.DEAL_PRECONDITION]: {
      title: t("computed.staleTitle"),
      body: t("computed.staleBody"),
    },
    [ERROR_IDS.DEAL_NOT_FOUND]: {
      title: t("computed.unavailableTitle"),
      body: t("computed.unavailableBody"),
    },
    [ERROR_IDS.AUTH_SESSION_DEAD]: {
      title: t("computed.sessionTitle"),
      body: t("computed.signInAgain"),
    },
    E_AUTH_CSRF: { title: t("computed.sessionTitle"), body: t("computed.refreshAgain") },
  };
  return errorId === undefined ? generic : (content[errorId] ?? generic);
}
