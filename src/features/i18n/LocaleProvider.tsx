"use client";

import { NextIntlClientProvider } from "next-intl";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { DirectionProvider } from "@/components/ui/direction";
import type { IranianMoneyUnit } from "@/lib/iranianMoney";
import { localeTagForFormatting } from "@/lib/localeFormatting";
import { displayNumberingSystem, type NumberingSystem } from "@/lib/numberingSystem";
import { type AppNamespace, createAppTranslator, messagesForLocale } from "./catalog";
import {
  type CalendarSystem,
  type LocalePreferences,
  resolveLocalePreferences,
} from "./preferences";
import { directionForLocale, type Locale } from "./registry";
import { useBrowserRegionalContext } from "./useBrowserRegionalContext";
import { usePreferencePersistence } from "./usePreferencePersistence";

const DEFAULT_PREFERENCES = resolveLocalePreferences({});
const LocaleContext = createContext<{
  preferences: LocalePreferences;
  pending: boolean;
  choose: (patch: Partial<LocalePreferences>) => Promise<boolean>;
}>({
  preferences: DEFAULT_PREFERENCES,
  pending: false,
  choose: (): Promise<boolean> => Promise.resolve(false),
});

export function LocaleProvider({
  locale = "en",
  calendar,
  timeZone,
  country,
  timeZoneMode,
  numberingSystem,
  iranianMoneyUnit,
  detectBrowserContext = false,
  inferBrowserLanguage = false,
  inferBrowserFormats = false,
  children,
}: {
  locale?: Locale;
  calendar?: CalendarSystem;
  timeZone?: string;
  country?: string;
  timeZoneMode?: "browser" | "manual";
  numberingSystem?: NumberingSystem;
  iranianMoneyUnit?: IranianMoneyUnit;
  detectBrowserContext?: boolean;
  inferBrowserLanguage?: boolean;
  inferBrowserFormats?: boolean;
  children: ReactNode;
}): ReactNode {
  const stored = useMemo(
    () =>
      resolveLocalePreferences({
        locale,
        calendar,
        timeZone,
        country,
        timeZoneMode,
        numberingSystem,
        iranianMoneyUnit,
      }),
    [locale, calendar, timeZone, country, timeZoneMode, numberingSystem, iranianMoneyUnit],
  );
  const choice = usePreferencePersistence(stored);
  useBrowserRegionalContext({
    enabled: detectBrowserContext,
    inferBrowserLanguage,
    inferBrowserFormats,
    preferences: choice.preferences,
    pending: choice.pending,
    choose: choice.choose,
  });
  const preferences = choice.preferences;
  const messages = messagesForLocale(preferences.locale);
  return (
    <LocaleContext.Provider value={{ preferences, pending: choice.pending, choose: choice.choose }}>
      <NextIntlClientProvider
        locale={localeTagForFormatting(preferences)}
        timeZone={preferences.timeZone}
        messages={messages}
      >
        <DirectionProvider direction={directionForLocale(preferences.locale)}>
          {choice.pending && (
            <p role="status" className="sr-only">
              {messages.preferences.saving}
            </p>
          )}
          {choice.error && (
            <p role="alert" className="p-3 text-sm text-destructive">
              {messages.preferences.saveError}
            </p>
          )}
          {children}
        </DirectionProvider>
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

export function useLocalePreferences(): LocalePreferences {
  return useContext(LocaleContext).preferences;
}

export function useLocale(): Locale {
  return useLocalePreferences().locale;
}

export function useCalendarSystem(): CalendarSystem {
  return useLocalePreferences().calendar;
}

export function useNumberingSystem(): NumberingSystem {
  return displayNumberingSystem(useLocalePreferences());
}

export function useSetLocalePreferences(): (patch: Partial<LocalePreferences>) => Promise<boolean> {
  return useContext(LocaleContext).choose;
}

export function useLocalePreferencePending(): boolean {
  return useContext(LocaleContext).pending;
}

export function useMessages(): ReturnType<typeof messagesForLocale> {
  return messagesForLocale(useLocale());
}

export function useAppTranslations<Namespace extends AppNamespace>(namespace: Namespace) {
  const { locale, numberingSystem, country } = useLocalePreferences();
  return useMemo(
    () => createAppTranslator(locale, namespace, numberingSystem, country),
    [locale, namespace, numberingSystem, country],
  );
}

export { LanguageMenuItem, LanguageSwitcher } from "./LanguageSwitcher";
