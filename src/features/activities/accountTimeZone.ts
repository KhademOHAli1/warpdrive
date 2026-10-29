import type { Db } from "@/db/client";
import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import { getPreferencesForActor } from "@/features/identity/preferencesForActor";
export async function activityAccountPreferences(
  db: Db,
  userId: string,
  fallback?: { timeZone?: string },
) {
  const prefs = await getPreferencesForActor(db, userId);
  return resolveAccountLocalePreferences({
    saved: prefs.ui.localePreferences,
    profileTimeZone: prefs.timezone,
    fallback,
  });
}
