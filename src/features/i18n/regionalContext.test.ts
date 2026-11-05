import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectRegionalContext,
  isRegionalCountry,
  REGIONAL_COUNTRIES,
  regionalFormatDefaults,
  regionalTimeZones,
} from "./regionalContext";

afterEach(() => vi.restoreAllMocks());

describe("browser regional context", () => {
  it("suggests the time zone's country ahead of a browser language region", () => {
    expect(detectRegionalContext({ languages: ["en-US"], timeZone: "Europe/Berlin" })).toEqual({
      country: "DE",
      locale: "en",
      timeZone: "Europe/Berlin",
    });
    expect(detectRegionalContext({ languages: ["fa-IR"], timeZone: "Asia/Tehran" })).toEqual({
      country: "IR",
      locale: "fa",
      timeZone: "Asia/Tehran",
    });
  });

  it("negotiates a supported interface language without changing the country", () => {
    expect(
      detectRegionalContext({ languages: ["fr-FR", "de-DE", "en-US"], timeZone: "Europe/Paris" }),
    ).toEqual({ country: "FR", locale: "de", timeZone: "Europe/Paris" });
    expect(detectRegionalContext({ languages: ["fr-FR"], timeZone: "Europe/Paris" }).locale).toBe(
      "en",
    );
  });

  it("uses explicit browser region when a time zone cannot suggest a country", () => {
    expect(detectRegionalContext({ languages: ["en-GB"], timeZone: "UTC" })).toEqual({
      country: "GB",
      locale: "en",
      timeZone: "UTC",
    });
    expect(detectRegionalContext({ languages: ["de"], timeZone: "UTC" })).toEqual({
      locale: "de",
      timeZone: "UTC",
    });
  });

  it("handles unavailable or invalid browser signals without inventing a country", () => {
    expect(detectRegionalContext({ languages: [], timeZone: "Invalid/Zone" })).toEqual({
      locale: "en",
      timeZone: "UTC",
    });
    expect(
      detectRegionalContext({ languages: ["not_a_locale", "en-ZZ"], timeZone: "UTC" }),
    ).toEqual({
      locale: "en",
      timeZone: "UTC",
    });
  });

  it("resolves an older IANA alias to the relevant country", () => {
    expect(detectRegionalContext({ languages: ["en-GB"], timeZone: "US/Pacific" })).toEqual(
      expect.objectContaining({ country: "US", locale: "en" }),
    );
    expect(
      new Intl.DateTimeFormat("en", {
        timeZone: detectRegionalContext({ languages: [], timeZone: "US/Pacific" }).timeZone,
      }).resolvedOptions().timeZone,
    ).toBe(
      new Intl.DateTimeFormat("en", { timeZone: "America/Los_Angeles" }).resolvedOptions().timeZone,
    );
  });

  it("does not choose the first country when the runtime combines time zone aliases", () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
      this: Intl.DateTimeFormat,
    ) {
      const resolved = original.call(this);
      if (resolved.timeZone === "Europe/Bratislava") resolved.timeZone = "Europe/Prague";
      return resolved;
    });
    expect(
      detectRegionalContext({ languages: ["en"], timeZone: "Europe/Prague" }).country,
    ).toBeUndefined();
    expect(detectRegionalContext({ languages: ["sk-SK"], timeZone: "Europe/Prague" }).country).toBe(
      "SK",
    );
  });
});

describe("country-specific regional formats", () => {
  it("offers validated ISO countries independently of available interface languages", () => {
    expect(REGIONAL_COUNTRIES).toHaveLength(249);
    for (const country of ["DE", "IR", "GB", "US", "JP", "AQ"]) {
      expect(isRegionalCountry(country)).toBe(true);
    }
    for (const country of ["ZZ", "de", "001", "", null, undefined]) {
      expect(isRegionalCountry(country)).toBe(false);
    }
  });

  it("chooses Iranian defaults only when both country and language make them relevant", () => {
    expect(regionalFormatDefaults("IR", "fa")).toEqual({
      calendar: "persian",
      numberingSystem: "arabext",
    });
    for (const [country, locale] of [
      ["DE", "fa"],
      ["IR", "en"],
      ["US", "en"],
      [undefined, "fa"],
    ] as const) {
      expect(regionalFormatDefaults(country, locale)).toEqual({
        calendar: "gregory",
        numberingSystem: "latn",
      });
    }
  });

  it("offers each country's zones rather than a random global short list", () => {
    expect(regionalTimeZones("IR")).toContain("Asia/Tehran");
    expect(regionalTimeZones("DE")).toContain("Europe/Berlin");
    expect(regionalTimeZones("US")).toEqual(
      expect.arrayContaining(["America/New_York", "America/Los_Angeles"]),
    );
    expect(regionalTimeZones("IR")).not.toContain("America/New_York");
    expect(regionalTimeZones(undefined)).toEqual(
      expect.arrayContaining(["UTC", "Asia/Tehran", "Europe/Berlin"]),
    );
    expect(regionalTimeZones("ZZ")).toEqual([]);
  });
});
