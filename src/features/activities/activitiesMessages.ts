import { createTranslator } from "next-intl";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import english from "./messages/activities.en.json";
import persian from "./messages/activities.fa.json";

export function activitiesMessagesForLocale(locale: Locale, numberingSystem?: NumberingSystem) {
  const messages = locale === "fa" ? persian : english;
  const t = createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages,
  });
  return {
    ...messages,
    activityCount: (count: number) => t("activityCount", { count }),
    showMore: (count: number) => t("showMore", { count }),
    duration: (count: number) => t("duration", { count }),
    activityLoad: (count: number, target: number) => t("activityLoad", { count, target }),
    createFailed: (id: string) => t("createFailed", { id }),
    saveFailed: (id: string) => t("saveFailed", { id }),
    deleteFailed: (id: string) => t("deleteFailed", { id }),
    updateFailed: (id: string) => t("updateFailed", { id }),
    selectActivity: (subject: string) => t("selectActivity", { subject }),
    completeActivity: (subject: string) => t("completeActivity", { subject }),
    markSubjectDone: (subject: string) => t("markSubjectDone", { subject }),
  };
}
