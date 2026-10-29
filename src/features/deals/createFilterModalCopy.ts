import { createAppTranslator } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import { assertNever } from "@/types/result";

// What Save does for the filter the dialog was opened on. updateSavedFilter is owner-scoped in SQL,
// so a shared filter owned by someone else can only be forked, never updated in place.
export type FilterSaveMode = "create" | "update" | "fork";

export function filterSaveMode(savedFilter?: { isOwn: boolean }): FilterSaveMode {
  if (savedFilter === undefined) return "create";
  return savedFilter.isOwn ? "update" : "fork";
}

export interface FilterSaveCopy {
  title: string;
  saveLabel: string;
  // Only the fork needs explaining: the user opened a filter to edit and gets a copy instead.
  note: string | null;
}

export function filterSaveCopy(mode: FilterSaveMode, locale: Locale = "en"): FilterSaveCopy {
  const t = createAppTranslator(locale, "sales");
  switch (mode) {
    case "create":
      return { title: t("computed.createFilterTitle"), saveLabel: t("computed.save"), note: null };
    case "update":
      return {
        title: t("computed.editFilterTitle"),
        saveLabel: t("computed.saveChanges"),
        note: null,
      };
    case "fork":
      return {
        title: t("computed.copyFilterTitle"),
        saveLabel: t("computed.saveAsNew"),
        note: t("computed.copyFilterNote"),
      };
    default:
      return assertNever(mode);
  }
}
