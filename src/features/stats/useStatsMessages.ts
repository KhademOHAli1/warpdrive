"use client";
import { useMemo } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { statsMessagesForLocale } from "./statsMessages";
export function useStatsMessages() {
  const locale = useLocale();
  return useMemo(() => statsMessagesForLocale(locale), [locale]);
}
