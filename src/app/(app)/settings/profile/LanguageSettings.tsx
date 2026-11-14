"use client";

import { useMemo } from "react";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useHydrated } from "@/lib/useHydrated";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";
import { BrowserTimeZoneSetting } from "./BrowserTimeZoneSetting";
import { CountryLanguageSettings } from "./CountryLanguageSettings";
import { RegionalFormatsSettings } from "./RegionalFormatsSettings";
import { formatRegionalPreview, type RegionalPreview } from "./regionalPreview";

export function LanguageSettings({ initialPreview }: { initialPreview?: RegionalPreview } = {}) {
  const L = useSettingsMessages();
  const H = L._hierarchy;
  const preferences = useLocalePreferences();
  // ICU can differ between server and browser. Keep the server's exact text through hydration.
  const hydrated = useHydrated();
  const preview = useMemo(
    () =>
      !hydrated && initialPreview !== undefined
        ? initialPreview
        : formatRegionalPreview(preferences),
    [hydrated, initialPreview, preferences],
  );
  return (
    <>
      <SettingsCard>
        <SettingsCardHeader title={H.regional} description={H.autoSave} />
        <SettingsCardBody className="space-y-4">
          <CountryLanguageSettings />
          <BrowserTimeZoneSetting />
          <RegionalFormatsSettings />
        </SettingsCardBody>
      </SettingsCard>
      <SettingsCard>
        <SettingsCardHeader title={H.preview} description={H.previewDescription} />
        <SettingsCardBody>
          <dl className="grid gap-4 sm:grid-cols-3" aria-live="polite">
            <div>
              <dt className="text-xs text-muted-foreground">{H.previewDate}</dt>
              <dd className="mt-1 text-sm">
                <bdi dir="auto">{preview.date}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{H.previewTime}</dt>
              <dd className="mt-1 text-sm">
                <bdi dir="auto">{preview.localDate}</bdi>
                <span aria-hidden="true"> · </span>
                <bdi dir="auto">{preview.time}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{H.previewNumber}</dt>
              <dd className="mt-1 text-sm tabular-nums">
                <bdi dir="auto">{preview.number}</bdi>
              </dd>
            </div>
          </dl>
        </SettingsCardBody>
      </SettingsCard>
    </>
  );
}
