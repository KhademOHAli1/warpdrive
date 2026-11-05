"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import {
  useAppTranslations,
  useLocalePreferencePending,
  useLocalePreferences,
  useSetLocalePreferences,
} from "@/features/i18n/LocaleProvider";
import { regionalTimeZones } from "@/features/i18n/regionalContext";
import { readBrowserTimeZone } from "@/features/i18n/useBrowserRegionalContext";

function subscribeToBrowserZone(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  return () => window.removeEventListener("focus", onChange);
}

function serverTimeZone(): null {
  return null;
}

export function BrowserTimeZoneSetting() {
  const t = useAppTranslations("preferences");
  const preferences = useLocalePreferences();
  const pending = useLocalePreferencePending();
  const choose = useSetLocalePreferences();
  const browserTimeZone = useSyncExternalStore<string | undefined | null>(
    subscribeToBrowserZone,
    readBrowserTimeZone,
    serverTimeZone,
  );
  const automatic =
    preferences.timeZoneMode === "browser" ||
    (preferences.timeZoneMode === undefined && preferences.timeZone === "UTC");
  const timeZones = useMemo(
    () => [
      ...new Set([
        ...regionalTimeZones(preferences.country),
        preferences.timeZone,
        "UTC",
        ...(browserTimeZone == null ? [] : [browserTimeZone]),
        ...regionalTimeZones(undefined),
      ]),
    ],
    [preferences.timeZone, preferences.country, browserTimeZone],
  );
  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium">{t("browserTimeZone")}</p>
          <p className="text-xs text-muted-foreground">{t("browserTimeZoneHelp")}</p>
        </div>
        <Switch
          checked={automatic}
          label={t("browserTimeZone")}
          disabled={pending || (!automatic && browserTimeZone == null)}
          onCheckedChange={(checked) => {
            void choose({
              timeZoneMode: checked ? "browser" : "manual",
              timeZone: checked ? (browserTimeZone ?? preferences.timeZone) : preferences.timeZone,
            });
          }}
        />
      </div>
      {automatic && browserTimeZone !== undefined ? (
        <p className="text-sm text-muted-foreground">
          <bdi>{preferences.timeZone}</bdi>
        </p>
      ) : (
        <div className="space-y-1.5">
          {automatic && (
            <p className="text-xs text-muted-foreground">{t("browserTimeZoneUnavailable")}</p>
          )}
          <p className="text-sm font-medium">{t("timeZone")}</p>
          <Select
            ariaLabel={t("timeZone")}
            value={preferences.timeZone}
            disabled={pending}
            options={timeZones.map((timeZone) => ({ value: timeZone, label: timeZone }))}
            onChange={(timeZone) => {
              if (timeZones.includes(timeZone)) void choose({ timeZone, timeZoneMode: "manual" });
            }}
          />
        </div>
      )}
    </div>
  );
}
