import { ERROR_IDS } from "@/constants/errorIds";
import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

// Map convert AppError ids to user-facing copy. The stale-CAS conflict is surfaced by leadConvert as
// LEAD_NOT_FOUND ("Lead changed before convert"), so it reads as a refresh prompt, not a hard error.
const MESSAGES: Record<
  string,
  | "youDoNotHavePermissionToCreateDeals"
  | "thisLeadWasAlreadyConverted"
  | "thisLeadChangedSinceItLoadedRefreshing"
  | "noTargetPipelineIsConfiguredForConvert"
> = {
  [ERROR_IDS.PERM_DENIED]: "youDoNotHavePermissionToCreateDeals",
  [ERROR_IDS.LEAD_ALREADY_CONVERTED]: "thisLeadWasAlreadyConverted",
  [ERROR_IDS.LEAD_NOT_FOUND]: "thisLeadChangedSinceItLoadedRefreshing",
  [ERROR_IDS.LEAD_CONVERT_NO_PIPELINE]: "noTargetPipelineIsConfiguredForConvert",
};

export function convertErrorMessage(id: string, locale: Locale = "en"): string {
  const t = createAppTranslator(locale, "leads");
  return t(MESSAGES[id] ?? "couldNotConvertThisLead");
}
