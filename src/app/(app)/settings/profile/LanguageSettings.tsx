"use client";

import { Select } from "@/components/ui/Select";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
  useNumberingSystem,
  useSetLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { LOCALE_REGISTRY, SELECTABLE_LOCALES } from "@/features/i18n/registry";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";

export function LanguageSettings() {
  const t = useAppTranslations("preferences");
  const preferences = useLocalePreferences();
  const numbers = useNumberingSystem();
  const pending = useLocalePreferencePending();
  const choose = useSetLocalePreferences();
  return (
    <SettingsCard>
      <SettingsCardHeader title={t("settingsTitle")} description={t("settingsDescription")} />
      <SettingsCardBody className="space-y-4">
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
              if (locale !== undefined) void choose({ locale });
            }}
          />
        </div>
        {preferences.locale === "fa" && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("numberDisplay")}</p>
            <Select
              ariaLabel={t("numberDisplay")}
              value={numbers}
              disabled={pending}
              options={[
                { value: "arabext", label: t("persianNumbers") },
                { value: "latn", label: t("englishNumbers") },
              ]}
              onChange={(value) => {
                if (value === "arabext" || value === "latn")
                  void choose({ numberingSystem: value });
              }}
            />
            <p className="text-sm text-muted-foreground">{t("numberHelp")}</p>
            <p className="text-sm tabular-nums" aria-live="polite">
              {t("numberPreview", { value: 12345.67 })}
            </p>
          </div>
        )}
      </SettingsCardBody>
    </SettingsCard>
  );
}
