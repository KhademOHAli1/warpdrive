"use client";
import { useMemo } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { settingsIdentityError, settingsMessagesForLocale } from "./settingsMessages";

export function useSettingsMessages() {
  const { locale, numberingSystem } = useLocalePreferences();
  return useMemo(
    () => settingsMessagesForLocale(locale, numberingSystem),
    [locale, numberingSystem],
  );
}

export function useSettingsErrorMessage() {
  const messages = useSettingsMessages();
  return (error: string): string => settingsIdentityError(messages, error);
}
