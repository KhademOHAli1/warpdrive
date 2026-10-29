import { createTranslator } from "next-intl";
import type { Locale } from "@/features/i18n/registry";
import en from "./messages/stats.en.json";
import fa from "./messages/stats.fa.json";
export function statsMessagesForLocale(locale: Locale) {
  const copy = locale === "fa" ? fa : en;
  const t = createTranslator({ locale, messages: copy });
  return {
    ...copy,
    _extra: {
      ...copy._extra,
      percent: (count: number) => t("_extra.percent", { count }),
      durationDays: (count: number) => t("_extra.durationDays", { count }),
      trendDeals: (amount: string, count: number) => t("_extra.trendDeals", { amount, count }),
    },
  };
}
export type StatsMessages = ReturnType<typeof statsMessagesForLocale>;
