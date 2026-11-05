import { isRegionalCountry, REGIONAL_COUNTRIES, type RegionalCountry } from "./regionalCountries";
import { COUNTRY_TIME_ZONES, TIME_ZONE_ALIASES } from "./regionalTimeZones";
import { type Locale, SELECTABLE_LOCALES } from "./registry";

export { isRegionalCountry, REGIONAL_COUNTRIES, type RegionalCountry } from "./regionalCountries";

export interface RegionalContext {
  country?: RegionalCountry;
  locale: Locale;
  timeZone: string;
}

type TimeZoneCountries = Map<string, Set<RegionalCountry>>;
const countryIndexes = new WeakMap<object, TimeZoneCountries>();
const locationTimeZones = Object.values(COUNTRY_TIME_ZONES).flat();
const locationZones = new Set(locationTimeZones);

function canonicalTimeZone(timeZone: string): string | undefined {
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone;
    // Preserve location names when the browser provides them; modern Intl may keep old aliases.
    const alias = locationZones.has(resolved) ? undefined : TIME_ZONE_ALIASES[resolved];
    const canonical =
      alias === undefined
        ? resolved
        : new Intl.DateTimeFormat("en", { timeZone: alias }).resolvedOptions().timeZone;
    return canonical === "Etc/UTC" ? "UTC" : canonical;
  } catch {
    return undefined;
  }
}

function countriesByTimeZone(): TimeZoneCountries {
  // The function identity invalidates the cache when the runtime replaces its zone resolver.
  const resolver: unknown = Object.getOwnPropertyDescriptor(
    Intl.DateTimeFormat.prototype,
    "resolvedOptions",
  )?.value;
  const cacheKey = typeof resolver === "function" ? resolver : Intl.DateTimeFormat.prototype;
  const cached = countryIndexes.get(cacheKey);
  if (cached !== undefined) return cached;
  const index: TimeZoneCountries = new Map();
  for (const country of REGIONAL_COUNTRIES) {
    for (const timeZone of COUNTRY_TIME_ZONES[country] ?? []) {
      const canonical = canonicalTimeZone(timeZone);
      if (canonical === undefined) continue;
      const countries = index.get(canonical) ?? new Set<RegionalCountry>();
      countries.add(country);
      index.set(canonical, countries);
    }
  }
  countryIndexes.set(cacheKey, index);
  return index;
}

function browserLocales(languages: readonly string[]): Intl.Locale[] {
  return languages.flatMap((language) => {
    try {
      return [new Intl.Locale(language)];
    } catch {
      return [];
    }
  });
}

// These signals suggest regional formats; they do not establish a person's physical location.
export function detectRegionalContext({
  languages,
  timeZone: browserTimeZone,
}: {
  languages: readonly string[];
  timeZone: string;
}): RegionalContext {
  const locales = browserLocales(languages);
  const locale =
    locales
      .map((item) => SELECTABLE_LOCALES.find((candidate) => candidate === item.language))
      .find((candidate) => candidate !== undefined) ?? "en";
  const timeZone = canonicalTimeZone(browserTimeZone) ?? "UTC";
  const candidates = countriesByTimeZone().get(timeZone);
  const regions = locales.map((item) => item.region).filter(isRegionalCountry);
  const country =
    candidates?.size === 1
      ? [...candidates][0]
      : regions.find((region) => candidates === undefined || candidates.has(region));
  return { ...(country === undefined ? {} : { country }), locale, timeZone };
}

export function regionalFormatDefaults(
  country: string | undefined,
  locale: Locale,
): {
  calendar: "gregory" | "persian";
  numberingSystem: "latn" | "arabext";
} {
  return country === "IR" && locale === "fa"
    ? { calendar: "persian", numberingSystem: "arabext" }
    : { calendar: "gregory", numberingSystem: "latn" };
}

export function regionalTimeZones(country: string | undefined): string[] {
  const zones =
    country === undefined
      ? ["UTC", ...locationTimeZones]
      : isRegionalCountry(country)
        ? (COUNTRY_TIME_ZONES[country] ?? [])
        : [];
  return [...new Set(zones.flatMap((zone) => canonicalTimeZone(zone) ?? []))].sort();
}
