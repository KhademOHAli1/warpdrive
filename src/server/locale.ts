import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import { readLocalePreferenceCookies } from "@/features/i18n/localePreferenceCookies";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
import { cookies } from "@/server/request";
import { createContext } from "@/server/trpc/context";

/** Locale for backend exports; shares preference resolution without calling the frontend. */
export async function getLocalePreferences() {
  const context = await createContext();
  const saved =
    context.actor === null ? null : await getPreferencesForActor(context.db, context.actor.id);
  return resolveAccountLocalePreferences({
    saved: saved?.ui.localePreferences,
    profileTimeZone: saved?.timezone ?? null,
    fallback: readLocalePreferenceCookies(await cookies()),
  });
}
