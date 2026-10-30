import { createTranslator } from "next-intl";
import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import german from "./messages/activities.de.json";
import english from "./messages/activities.en.json";
import persian from "./messages/activities.fa.json";

const messagesByLocale: Record<Locale, MessageCatalog<typeof english>> = {
  en: english,
  fa: persian,
  de: german,
};

export function activitiesMessagesForLocale(locale: Locale, numberingSystem?: NumberingSystem) {
  const messages = messagesByLocale[locale];
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
