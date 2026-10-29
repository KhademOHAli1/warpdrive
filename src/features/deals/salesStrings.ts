import { createAppTranslator, messagesForLocale } from "@/features/i18n/catalog";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";

// Compatibility for the sales surfaces that previously consumed structured constants. Dynamic
// copy is formatted by the same typed ICU catalog as new components, never by module-global locale.
export function createSalesStrings(locale: Locale = "en", numberingSystem?: NumberingSystem) {
  const source = messagesForLocale(locale).sales.legacy;
  const t = createAppTranslator(locale, "sales", numberingSystem);
  return {
    ...source,
    settings: {
      ...source.settings,
      deleteStageTitle: (stage: string) => t("legacy.settings.deleteStageTitle", { stage }),
      deleteStageDescription: (deals: string) =>
        t("legacy.settings.deleteStageDescription", { deals }),
      stageDeleteFailed: (stage: string, reason: string) =>
        t("legacy.settings.stageDeleteFailed", { stage, reason }),
    },
    board: {
      ...source.board,
      announcements: {
        ...source.board.announcements,
        pickedUp: (title: string, stage: string) =>
          stage === ""
            ? t("legacy.board.announcements.pickedUp", { title })
            : t("legacy.board.announcements.pickedUpWithStage", { title, stage }),
        movedTo: (stage: string) => t("legacy.board.announcements.movedTo", { stage }),
        droppedIn: (stage: string) => t("legacy.board.announcements.droppedIn", { stage }),
      },
    },
    dealSidebar: {
      ...source.dealSidebar,
      menu: {
        ...source.dealSidebar.menu,
        editSection: (section: string) => t("legacy.dealSidebar.menu.editSection", { section }),
        sectionOptions: (section: string) =>
          t("legacy.dealSidebar.menu.sectionOptions", { section }),
      },
    },
  };
}
