"use client";

import { useMemo } from "react";
import { Combobox } from "@/components/ui/Combobox";
import { Select } from "@/components/ui/Select";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
  useSetLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import {
  isRegionalCountry,
  REGIONAL_COUNTRIES,
  regionalFormatDefaults,
} from "@/features/i18n/regionalContext";
import { LOCALE_REGISTRY, SELECTABLE_LOCALES } from "@/features/i18n/registry";

export function CountryLanguageSettings() {
  const t = useAppTranslations("preferences");
  const preferences = useLocalePreferences();
  const pending = useLocalePreferencePending();
  const choose = useSetLocalePreferences();
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([preferences.locale], { type: "region" });
    return REGIONAL_COUNTRIES.map((country) => ({
      value: country,
      label: names.of(country) ?? country,
    })).sort((a, b) => a.label.localeCompare(b.label, preferences.locale));
  }, [preferences.locale]);
  return (
    <>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t("country")}</p>
        <Combobox
          ariaLabel={t("country")}
          placeholder={t("countryPlaceholder")}
          value={preferences.country ?? ""}
          options={countries}
          disabled={pending}
          onChange={(country) => {
            if (isRegionalCountry(country))
              void choose({ country, ...regionalFormatDefaults(country, preferences.locale) });
          }}
        />
        <p className="text-xs text-muted-foreground">{t("countryHelp")}</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t("language")}</p>
        <Select
          ariaLabel={t("language")}
          value={preferences.locale}
          disabled={pending}
          options={SELECTABLE_LOCALES.map((locale) => ({
            value: locale,
            label: LOCALE_REGISTRY[locale].name,
          }))}
          onChange={(value) => {
            const locale = SELECTABLE_LOCALES.find((item) => item === value);
            if (locale === undefined) return;
            const defaults = regionalFormatDefaults(preferences.country, preferences.locale);
            const usesDefaults =
              preferences.country !== undefined &&
              preferences.calendar === defaults.calendar &&
              (preferences.numberingSystem ?? defaults.numberingSystem) ===
                defaults.numberingSystem;
            void choose({
              locale,
              ...(usesDefaults ? regionalFormatDefaults(preferences.country, locale) : {}),
            });
          }}
        />
      </div>
    </>
  );
}
