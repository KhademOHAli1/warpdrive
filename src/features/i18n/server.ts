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
  LOCALE_COOKIE,
  NUMBERING_SYSTEM_COOKIE,
  resolveLocalePreferences,
  TIME_ZONE_COOKIE,
} from "./preferences";

export const getLocalePreferences = cache(async () => {
  const jar = await cookies();
  const raw = {
    locale: jar.get(LOCALE_COOKIE)?.value,
    calendar: jar.get(CALENDAR_COOKIE)?.value,
    timeZone: jar.get(TIME_ZONE_COOKIE)?.value,
    numberingSystem: jar.get(NUMBERING_SYSTEM_COOKIE)?.value,
  };
  if (jar.get(SESSION_COOKIE) === undefined) return resolveLocalePreferences(raw);
  const { actor } = await createContext();
  if (actor === null) return resolveLocalePreferences(raw);
  const preferences = await getPreferencesForActor(db, actor.id);
  return resolveAccountLocalePreferences({
    saved: preferences.ui.localePreferences,
    profileTimeZone: preferences.timezone,
    fallback: raw,
  });
});

export async function getAppTranslations<Namespace extends AppNamespace>(namespace: Namespace) {
  const preferences = await getLocalePreferences();
  return createAppTranslator(preferences.locale, namespace, preferences.numberingSystem);
}

export { getTranslations } from "next-intl/server";
