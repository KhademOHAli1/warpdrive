import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/db/client";
import { SESSION_COOKIE } from "@/features/auth/session";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { createContext } from "@/server/trpc/context";
import { resolveAccountLocalePreferences } from "./accountPreferences";
import { type AppNamespace, createAppTranslator } from "./catalog";
import {
  CALENDAR_COOKIE,
  COUNTRY_COOKIE,
  IRANIAN_MONEY_UNIT_COOKIE,
  LOCALE_COOKIE,
  type LocalePreferences,
  NUMBERING_SYSTEM_COOKIE,
  resolveLocalePreferences,
  TIME_ZONE_COOKIE,
  TIME_ZONE_MODE_COOKIE,
} from "./preferences";

function browserInitialization(
  raw: Parameters<typeof resolveLocalePreferences>[0],
  saved?: LocalePreferences,
) {
  return {
    // These hints travel to the provider, never into the account preference bag.
    inferBrowserLanguage: saved === undefined && raw.locale === undefined,
    inferBrowserFormats:
      saved === undefined &&
      raw.calendar === undefined &&
      raw.numberingSystem === undefined &&
      raw.country === undefined,
  };
}

export const getLocalePreferences = cache(async () => {
  const jar = await cookies();
  const raw = {
    locale: jar.get(LOCALE_COOKIE)?.value,
    calendar: jar.get(CALENDAR_COOKIE)?.value,
    timeZone: jar.get(TIME_ZONE_COOKIE)?.value,
    country: jar.get(COUNTRY_COOKIE)?.value,
    timeZoneMode: jar.get(TIME_ZONE_MODE_COOKIE)?.value,
    numberingSystem: jar.get(NUMBERING_SYSTEM_COOKIE)?.value,
    iranianMoneyUnit: jar.get(IRANIAN_MONEY_UNIT_COOKIE)?.value,
  };
  if (jar.get(SESSION_COOKIE) === undefined)
    return { ...resolveLocalePreferences(raw), ...browserInitialization(raw) };
  const { actor } = await createContext();
  if (actor === null) return { ...resolveLocalePreferences(raw), ...browserInitialization(raw) };
  const preferences = await getPreferencesForActor(db, actor.id);
  return {
    ...resolveAccountLocalePreferences({
      saved: preferences.ui.localePreferences,
      profileTimeZone: preferences.timezone,
      fallback: raw,
    }),
    ...browserInitialization(raw, preferences.ui.localePreferences),
  };
});

export async function getAppTranslations<Namespace extends AppNamespace>(namespace: Namespace) {
  const preferences = await getLocalePreferences();
  return createAppTranslator(
    preferences.locale,
    namespace,
    preferences.numberingSystem,
    preferences.country,
  );
}

export { getTranslations } from "next-intl/server";
