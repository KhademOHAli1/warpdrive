import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/db/client";
import { SESSION_COOKIE } from "@/features/auth/session";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { createContext } from "@/server/trpc/context";
import { resolveAccountLocalePreferences } from "./accountPreferences";
import { type AppNamespace, createAppTranslator } from "./catalog";
import {
  type LocalePreferenceFallback,
  readLocalePreferenceCookies,
} from "./localePreferenceCookies";
import { type LocalePreferences, resolveLocalePreferences } from "./preferences";

function browserInitialization(raw: LocalePreferenceFallback, saved?: LocalePreferences) {
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
  const raw = readLocalePreferenceCookies(jar);
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
