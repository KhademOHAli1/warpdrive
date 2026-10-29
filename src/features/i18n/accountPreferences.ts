import { isTimeZone, type LocalePreferences, resolveLocalePreferences } from "./preferences";

export function resolveAccountLocalePreferences({
  saved,
  profileTimeZone,
  fallback = {},
}: {
  saved?: LocalePreferences;
  profileTimeZone: string | null;
  fallback?: Parameters<typeof resolveLocalePreferences>[0];
}): LocalePreferences {
  return resolveLocalePreferences({
    ...(saved ?? fallback),
    timeZone:
      profileTimeZone !== null && isTimeZone(profileTimeZone)
        ? profileTimeZone
        : (saved?.timeZone ?? fallback.timeZone),
  });
}
