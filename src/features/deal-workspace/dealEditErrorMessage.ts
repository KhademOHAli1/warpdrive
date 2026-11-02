import { ERROR_IDS } from "@/constants/errorIds";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import { saveErrorMessage } from "@/features/inline-edit/saveError";

export function dealEditErrorMessage(errorId?: string, locale: Locale = "en"): string {
  return errorId === ERROR_IDS.DEAL_PRECONDITION
    ? createAppTranslator(locale, "sales")("computed.staleDraftBody")
    : saveErrorMessage(errorId, locale);
}
