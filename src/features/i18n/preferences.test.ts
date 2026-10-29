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

  it("rejects unsupported preference writes and recovers individual invalid cookies", () => {
    expect(
      localePreferencesSchema.safeParse({ locale: "de", calendar: "persian", timeZone: "UTC" })
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

  it("records German as planned without exposing an untranslated option", () => {
    expect(LOCALE_REGISTRY.de.status).toBe("planned");
    expect(SELECTABLE_LOCALES).toEqual(["en", "fa"]);
  });
});
