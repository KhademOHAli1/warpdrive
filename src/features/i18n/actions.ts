"use server";

import { cookies } from "next/headers";
import { env } from "@/config/env";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { setPreferences } from "@/features/identity/preferencesRepo";
import { createContext } from "@/server/trpc/context";
import {
  CALENDAR_COOKIE,
  LOCALE_COOKIE,
  localePreferencesSchema,
  NUMBERING_SYSTEM_COOKIE,
  PREFERENCE_COOKIE_MAX_AGE,
  TIME_ZONE_COOKIE,
} from "./preferences";

export type PreferenceSaveResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "forbidden" | "save_failed" };

export async function saveLocalePreferencesAction(
  input: unknown,
  csrfToken: string | null,
): Promise<PreferenceSaveResult> {
  const parsed = localePreferencesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const preferences = parsed.data;
  try {
    const { actor } = await createContext();
    if (actor !== null) {
      const csrf = await guardCsrf(csrfToken);
      if (!csrf.ok) return { ok: false, error: "forbidden" };
      await setPreferences(
        db,
        actor.id,
        { timezone: preferences.timeZone, ui: { localePreferences: preferences } },
        AbortSignal.timeout(8000),
      );
    }
    const jar = await cookies();
    const options = {
      path: "/",
      sameSite: "lax" as const,
      maxAge: PREFERENCE_COOKIE_MAX_AGE,
      secure: new URL(env.BASE_URL).protocol === "https:",
    };
    jar.set(LOCALE_COOKIE, preferences.locale, options);
    jar.set(CALENDAR_COOKIE, preferences.calendar, options);
    jar.set(TIME_ZONE_COOKIE, preferences.timeZone, options);
    if (preferences.numberingSystem === undefined) jar.delete(NUMBERING_SYSTEM_COOKIE);
    else jar.set(NUMBERING_SYSTEM_COOKIE, preferences.numberingSystem, options);
    return { ok: true };
  } catch {
    return { ok: false, error: "save_failed" };
  }
}
