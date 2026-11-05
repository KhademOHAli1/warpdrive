"use client";

import { useEffect, useRef } from "react";
import { displayNumberingSystem } from "@/lib/numberingSystem";
import { isTimeZone, type LocalePreferences } from "./preferences";
import {
  detectRegionalContext,
  type RegionalContext,
  regionalFormatDefaults,
} from "./regionalContext";

export function readBrowserTimeZone(): string | undefined {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isTimeZone(timeZone) ? timeZone : undefined;
  } catch {
    return undefined;
  }
}

function initialPreferencePatch(
  preferences: LocalePreferences,
  detected: RegionalContext,
  infer: { language: boolean; formats: boolean },
): Partial<LocalePreferences> {
  const patch: Partial<LocalePreferences> = {};
  const locale = infer.language ? detected.locale : preferences.locale;
  if (locale !== preferences.locale) patch.locale = locale;
  if (infer.formats) {
    const defaults = regionalFormatDefaults(preferences.country ?? detected.country, locale);
    if (preferences.calendar !== defaults.calendar) patch.calendar = defaults.calendar;
    if (preferences.numberingSystem !== defaults.numberingSystem)
      patch.numberingSystem = defaults.numberingSystem;
  }
  return patch;
}

function detectedPreferencePatch(
  preferences: LocalePreferences,
  detected: RegionalContext,
  timeZone: string | undefined,
  initial: Partial<LocalePreferences>,
): Partial<LocalePreferences> {
  const patch = { ...initial };
  if (preferences.country === undefined && detected.country !== undefined) {
    patch.country = detected.country;
    // An older account can have implicit digits. Keep their effective choice when adding a
    // country, rather than letting that newly saved country change the digits on reload.
    if (patch.numberingSystem === undefined && preferences.numberingSystem === undefined)
      patch.numberingSystem = displayNumberingSystem(preferences);
  }
  const followsBrowser =
    preferences.timeZoneMode === "browser" ||
    (preferences.timeZoneMode === undefined && preferences.timeZone === "UTC");
  if (followsBrowser && timeZone !== undefined) {
    if (preferences.timeZone !== timeZone) patch.timeZone = timeZone;
    if (preferences.timeZoneMode !== "browser") patch.timeZoneMode = "browser";
  }
  return patch;
}

export function useBrowserRegionalContext({
  enabled,
  inferBrowserLanguage,
  inferBrowserFormats,
  preferences,
  pending,
  choose,
}: {
  enabled: boolean;
  inferBrowserLanguage: boolean;
  inferBrowserFormats: boolean;
  preferences: LocalePreferences;
  pending: boolean;
  choose: (patch: Partial<LocalePreferences>) => Promise<boolean>;
}): void {
  const lastAttempt = useRef<string | undefined>(undefined);
  const initialized = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    function synchronize(): void {
      if (pending) return;
      const timeZone = readBrowserTimeZone();
      const detected = detectRegionalContext({
        languages: navigator.languages,
        timeZone: timeZone ?? "UTC",
      });
      const initial = initialized.current
        ? {}
        : initialPreferencePatch(preferences, detected, {
            language: inferBrowserLanguage,
            formats: inferBrowserFormats,
          });
      initialized.current = true;
      const patch = detectedPreferencePatch(preferences, detected, timeZone, initial);
      if (Object.keys(patch).length === 0) return;
      const attempt = JSON.stringify([detected.country, detected.locale, timeZone]);
      // A denied/failed automatic save must not retry on every render or focus. A different
      // detected context can try once; explicit user choices retain the normal save/retry flow.
      if (lastAttempt.current === attempt) return;
      lastAttempt.current = attempt;
      void choose(patch);
    }
    synchronize();
    window.addEventListener("focus", synchronize);
    return () => window.removeEventListener("focus", synchronize);
  }, [enabled, inferBrowserLanguage, inferBrowserFormats, preferences, pending, choose]);
}
