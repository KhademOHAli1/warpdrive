import { ERROR_IDS } from "@/constants/errorIds";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

export function stageEditErrorMessages(locale: Locale = "en"): Record<string, string> {
  const t = createAppTranslator(locale, "sales");
  return {
    E_STAGE_002: t("computed.stageHoldsDeals"),
    E_STAGE_003: t("computed.pipelineNeedsStage"),
    E_STAGE_004: t("computed.destinationDeleted"),
    E_PERM_001: t("computed.pipelineNoEdit"),
    E_AUTH_CSRF: t("computed.sessionExpired"),
    [ERROR_IDS.PIPELINE_NOT_FOUND]: t("computed.renameUnavailable"),
    [ERROR_IDS.PIPELINE_REVISION_CONFLICT]: t("computed.renameConflict"),
    [ERROR_IDS.PIPELINE_FRESH_AUTH_REQUIRED]: t("computed.renameFreshProof"),
    [ERROR_IDS.PIPELINE_RENAME_INPUT_INVALID]: t("computed.renameInvalid"),
    [ERROR_IDS.DB_WRITE_FAILED]: t("computed.saveUnconfirmed"),
    [ERROR_IDS.UI_ACTION_UNCONFIRMED]: t("computed.saveUnconfirmed"),
  };
}
export function stageDeleteFailureReasons(locale: Locale = "en"): Record<string, string> {
  return { E_STAGE_001: createAppTranslator(locale, "sales")("computed.stageAlreadyDeleted") };
}
export const STAGE_EDIT_ERROR_MESSAGE = stageEditErrorMessages();
export const STAGE_DELETE_FAILURE_REASON = stageDeleteFailureReasons();
