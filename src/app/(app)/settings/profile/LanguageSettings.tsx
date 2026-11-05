"use client";

import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { SettingsCard, SettingsCardBody, SettingsCardHeader } from "../SettingsSurface";
import { BrowserTimeZoneSetting } from "./BrowserTimeZoneSetting";
import { CountryLanguageSettings } from "./CountryLanguageSettings";
import { RegionalFormatsSettings } from "./RegionalFormatsSettings";

export function LanguageSettings() {
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
