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
  const legacyProfileOverride =
    saved === undefined &&
    profileTimeZone !== null &&
    profileTimeZone !== "UTC" &&
    isTimeZone(profileTimeZone);
  const source = saved ?? {
    ...fallback,
    // A browser-mode cookie left by a guest or another account must not retire an older
    // account's explicit profile override before it has a saved regional mode of its own.
    ...(legacyProfileOverride ? { timeZoneMode: undefined } : {}),
  };
  // Browser mode follows this device's cookie. The account retains its last detected zone for
  // scheduled/background work, where there is no browser request to consult.
  const deviceTimeZone =
    source.timeZoneMode === "browser" &&
    fallback.timeZone !== undefined &&
    isTimeZone(fallback.timeZone)
      ? fallback.timeZone
      : undefined;
  return resolveLocalePreferences({
    ...source,
    timeZone:
      source.timeZoneMode === "browser"
        ? (deviceTimeZone ?? source.timeZone)
        : profileTimeZone !== null && isTimeZone(profileTimeZone)
          ? profileTimeZone
          : (saved?.timeZone ?? fallback.timeZone),
  });
}
