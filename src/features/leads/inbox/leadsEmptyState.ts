import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";

// Which empty the inbox is showing. "filtered" must never be worded like "none": a filter that
// excludes everything is not the same fact as an inbox nobody has written to yet, and the two
// have different exits (clear the filter vs create a lead).
type LeadsEmptyKind = "none" | "none-archived" | "filtered";

export interface LeadsEmpty {
  kind: LeadsEmptyKind;
  title: string;
  body: string;
  action: string;
}

export function leadsEmptyState(
  {
    archived,
    hasFilter,
  }: {
    archived: boolean;
    hasFilter: boolean;
  },
  locale: Locale = "en",
): LeadsEmpty {
  const t = createAppTranslator(locale, "leads");
  if (hasFilter) {
    return {
      kind: "filtered",
      title: t("noLeadsMatchTheseFilters"),
      body: t("theFiltersAboveAreTheOnlyThingNarrowingThisViewClearThemToSeeItWhole"),
      action: t("clearFilters"),
    };
  }
  if (archived) {
    return {
      kind: "none-archived",
      title: t("nothingInTheArchive"),
      body: t("archivingALeadTakesItOutOfTheInboxWithoutDeletingItNothingIsArchivedRightNow"),
      action: t("backToInbox"),
    };
  }
  return {
    kind: "none",
    title: t("noLeadsYet"),
    body: t("aLeadIsAnUnqualifiedOpportunityYouWorkBeforeItEarnsAPlaceInThePipeline"),
    action: t("addLead"),
  };
}
