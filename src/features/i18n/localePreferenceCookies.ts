import {
  CALENDAR_COOKIE,
  COUNTRY_COOKIE,
  IRANIAN_MONEY_UNIT_COOKIE,
  LOCALE_COOKIE,
  NUMBERING_SYSTEM_COOKIE,
  type resolveLocalePreferences,
  TIME_ZONE_COOKIE,
  TIME_ZONE_MODE_COOKIE,
} from "./preferences";

export type LocalePreferenceFallback = Parameters<typeof resolveLocalePreferences>[0];

interface RegionalCookieSource {
  get(name: string): { value: string } | undefined;
}

// These values are only display/reporting preferences. Account choices and the
// locale resolver still validate them and decide which fallback values can apply.
export function readLocalePreferenceCookies(jar: RegionalCookieSource): LocalePreferenceFallback {
  return {
    locale: jar.get(LOCALE_COOKIE)?.value,
    calendar: jar.get(CALENDAR_COOKIE)?.value,
    timeZone: jar.get(TIME_ZONE_COOKIE)?.value,
    country: jar.get(COUNTRY_COOKIE)?.value,
    timeZoneMode: jar.get(TIME_ZONE_MODE_COOKIE)?.value,
    numberingSystem: jar.get(NUMBERING_SYSTEM_COOKIE)?.value,
    iranianMoneyUnit: jar.get(IRANIAN_MONEY_UNIT_COOKIE)?.value,
  };
}
