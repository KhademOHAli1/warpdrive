import { createTranslator } from "next-intl";
import type { MessageCatalog } from "@/features/i18n/messageTypes";
import type { Locale } from "@/features/i18n/registry";
import { localeWithNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import de from "./messages/stats.de.json";
import en from "./messages/stats.en.json";
import fa from "./messages/stats.fa.json";

const messagesByLocale: Record<Locale, MessageCatalog<typeof en>> = { en, fa, de };

export function statsMessagesForLocale(locale: Locale, numberingSystem?: NumberingSystem) {
  const copy = messagesByLocale[locale];
  const t = createTranslator({
    locale: localeWithNumberingSystem(locale, numberingSystem),
    messages: copy,
  });
  return {
    ...copy,
    _extra: {
      ...copy._extra,
      percent: (count: number) => t("_extra.percent", { count }),
      durationDays: (count: number) => t("_extra.durationDays", { count }),
      cohortHorizonDays: (count: number) => t("_extra.cohortHorizonDays", { count }),
      cohortOutcomeRange: (lower: string, upper: string) =>
        t("cohort.outcomeRange", { lower, upper }),
      trendDeals: (amount: string, count: number) => t("_extra.trendDeals", { amount, count }),
      recordsCount: (count: number) => t("_extra.recordsCount", { count }),
      recordsValueCount: (count: number, total: number) =>
        t("_extra.recordsValueCount", { count, total }),
      recordsPage: (page: number) => t("_extra.recordsPage", { page }),
    },
  };
}
export type StatsMessages = ReturnType<typeof statsMessagesForLocale>;
