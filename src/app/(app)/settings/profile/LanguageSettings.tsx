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
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";
import { IranianMoneySetting } from "./IranianMoneySetting";

export function LanguageSettings() {
  const t = useAppTranslations("preferences");
  const preferences = useLocalePreferences();
  const numbers = useNumberingSystem();
  const pending = useLocalePreferencePending();
  const choose = useSetLocalePreferences();
  const L = useSettingsMessages();
  const H = L._hierarchy;
  const format = useFormatters();
  // Bun and browser ICU versions use different connectors for a combined date/time.
  // Format the two fields independently so the server and client render the same text.
  const exampleInstant = "2026-03-21T09:30:00Z";
  const exampleDate = format.dateTime(exampleInstant, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const exampleTime = format.dateTime(exampleInstant, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const timeZones = [
    ...new Set([
      preferences.timeZone,
      "UTC",
      "Asia/Tehran",
      "Europe/Berlin",
      "Europe/London",
      "Europe/Kyiv",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Sydney",
    ]),
  ].sort();
  return (
    <>
      <SettingsCard>
        <SettingsCardHeader title={H.regional} description={H.autoSave} />
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
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("timeZone")}</p>
            <Select
              ariaLabel={t("timeZone")}
              value={preferences.timeZone}
              disabled={pending}
              options={timeZones.map((timeZone) => ({ value: timeZone, label: timeZone }))}
              onChange={(timeZone) => {
                if (timeZones.includes(timeZone)) void choose({ timeZone });
              }}
            />
            <p className="text-sm text-muted-foreground">{H.timeZoneHelp}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("calendar")}</p>
            <Select
              ariaLabel={t("calendar")}
              value={preferences.calendar}
              disabled={pending}
              options={[
                { value: "persian", label: t("persianCalendar") },
                { value: "gregory", label: t("gregorianCalendar") },
              ]}
              onChange={(value) => {
                if (value === "persian" || value === "gregory") void choose({ calendar: value });
              }}
            />
            <p className="text-sm text-muted-foreground">{t("calendarHelp")}</p>
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
          <IranianMoneySetting />
        </SettingsCardBody>
      </SettingsCard>
      <SettingsCard>
        <SettingsCardHeader title={H.preview} description={H.previewDescription} />
        <SettingsCardBody>
          <dl className="grid gap-4 sm:grid-cols-3" aria-live="polite">
            <div>
              <dt className="text-xs text-muted-foreground">{H.previewDate}</dt>
              <dd className="mt-1 text-sm">
                <bdi dir="auto">{format.dateOnly("2026-03-21")}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{H.previewTime}</dt>
              <dd className="mt-1 text-sm">
                <bdi dir="auto">{exampleDate}</bdi>
                <span aria-hidden="true"> · </span>
                <bdi dir="auto">{exampleTime}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{H.previewNumber}</dt>
              <dd className="mt-1 text-sm tabular-nums">
                <bdi dir="auto">{format.number(12345.67)}</bdi>
              </dd>
            </div>
          </dl>
        </SettingsCardBody>
      </SettingsCard>
    </>
  );
}
