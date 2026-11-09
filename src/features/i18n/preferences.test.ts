import { describe, expect, it } from "vitest";
import { localePreferencesSchema, resolveLocalePreferences } from "./preferences";
import { LOCALE_REGISTRY, SELECTABLE_LOCALES } from "./registry";

describe("language and regional preferences", () => {
  it("uses deterministic defaults and a language-appropriate calendar", () => {
    expect(resolveLocalePreferences({})).toEqual({
      locale: "en",
      calendar: "gregory",
      timeZone: "UTC",
    });
    expect(resolveLocalePreferences({ locale: "fa" })).toEqual({
      locale: "fa",
      calendar: "persian",
      timeZone: "UTC",
    });
  });

  it("keeps an explicit calendar independent of language", () => {
    expect(
      resolveLocalePreferences({ locale: "fa", calendar: "gregory", timeZone: "Asia/Tehran" }),
    ).toEqual({ locale: "fa", calendar: "gregory", timeZone: "Asia/Tehran" });
    expect(resolveLocalePreferences({ locale: "en", calendar: "persian" }).calendar).toBe(
      "persian",
    );
  });

  it("requires a named reporting zone while retaining named fixed-zone aliases", () => {
    const base = { locale: "en", calendar: "gregory" } as const;
    expect(localePreferencesSchema.safeParse({ ...base, timeZone: "+05:30" }).success).toBe(false);
    expect(resolveLocalePreferences({ ...base, timeZone: "-03:30" }).timeZone).toBe("UTC");
    expect(resolveLocalePreferences({ ...base, timeZone: "Etc/GMT+8" }).timeZone).toBe("Etc/GMT+8");
  });

  it("rejects unsupported preference writes and recovers individual invalid cookies", () => {
    expect(
      localePreferencesSchema.safeParse({ locale: "fr", calendar: "persian", timeZone: "UTC" })
        .success,
    ).toBe(false);
    expect(
      localePreferencesSchema.safeParse({
        locale: "fa",
        calendar: "persian",
        timeZone: "Invalid/Zone",
      }).success,
    ).toBe(false);
    expect(
      resolveLocalePreferences({ locale: "fa", calendar: "bad", timeZone: "Invalid/Zone" }),
    ).toEqual({ locale: "fa", calendar: "persian", timeZone: "UTC" });
  });

  it("accepts German with an independent Iranian calendar and deterministic defaults", () => {
    expect(LOCALE_REGISTRY.de.status).toBe("available");
    expect(SELECTABLE_LOCALES).toEqual(["en", "fa", "de"]);
    expect(resolveLocalePreferences({ locale: "de" })).toEqual({
      locale: "de",
      calendar: "gregory",
      timeZone: "UTC",
    });
    expect(
      localePreferencesSchema.parse({
        locale: "de",
        calendar: "persian",
        timeZone: "Europe/Berlin",
      }),
    ).toEqual({ locale: "de", calendar: "persian", timeZone: "Europe/Berlin" });
  });

  it("round-trips a country and browser time-zone mode independently of language", () => {
    const preferences = {
      locale: "en",
      calendar: "persian",
      timeZone: "Asia/Tehran",
      country: "IR",
      timeZoneMode: "browser",
      numberingSystem: "latn",
    } as const;
    expect(localePreferencesSchema.parse(preferences)).toEqual(preferences);
    expect(resolveLocalePreferences(preferences)).toEqual(preferences);
  });

  it("rejects unsupported countries and modes while recovering invalid cookies independently", () => {
    const base = { locale: "de", calendar: "gregory", timeZone: "Europe/Berlin" } as const;
    expect(localePreferencesSchema.safeParse({ ...base, country: "ZZ" }).success).toBe(false);
    expect(localePreferencesSchema.safeParse({ ...base, country: "de" }).success).toBe(false);
    expect(localePreferencesSchema.safeParse({ ...base, timeZoneMode: "guess" }).success).toBe(
      false,
    );
    expect(resolveLocalePreferences({ ...base, country: "ZZ", timeZoneMode: "guess" })).toEqual(
      base,
    );
  });

  it("uses country-aware defaults without changing explicit calendar or digit choices", () => {
    expect(resolveLocalePreferences({ locale: "fa", country: "DE" })).toEqual({
      locale: "fa",
      country: "DE",
      calendar: "gregory",
      numberingSystem: "latn",
      timeZone: "UTC",
    });
    expect(resolveLocalePreferences({ locale: "fa", country: "IR" })).toEqual({
      locale: "fa",
      country: "IR",
      calendar: "persian",
      numberingSystem: "arabext",
      timeZone: "UTC",
    });
    expect(resolveLocalePreferences({ locale: "en", country: "IR" }).calendar).toBe("gregory");
    expect(
      resolveLocalePreferences({
        locale: "fa",
        country: "DE",
        calendar: "persian",
        numberingSystem: "arabext",
      }),
    ).toMatchObject({ calendar: "persian", numberingSystem: "arabext" });
  });
});
