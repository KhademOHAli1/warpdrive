import { expect, it } from "vitest";
import { resolveAccountLocalePreferences } from "./accountPreferences";

it("keeps the saved zone when no valid profile zone is configured", () => {
  const saved = { locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" } as const;
  expect(resolveAccountLocalePreferences({ saved, profileTimeZone: null })).toEqual(saved);
  expect(resolveAccountLocalePreferences({ saved, profileTimeZone: "Invalid/Zone" })).toEqual(
    saved,
  );
  expect(
    resolveAccountLocalePreferences({ saved, profileTimeZone: "Europe/Berlin" }).timeZone,
  ).toBe("Europe/Berlin");
});

it("uses cookie preferences for older accounts and a deterministic UTC fallback", () => {
  expect(
    resolveAccountLocalePreferences({
      profileTimeZone: null,
      fallback: { locale: "fa", timeZone: "Asia/Tehran" },
    }),
  ).toEqual({ locale: "fa", calendar: "persian", timeZone: "Asia/Tehran" });
  expect(resolveAccountLocalePreferences({ profileTimeZone: null }).timeZone).toBe("UTC");
});

it("uses the current device zone in browser mode while preserving the saved country and language", () => {
  const saved = {
    locale: "fa",
    calendar: "persian",
    timeZone: "UTC",
    timeZoneMode: "browser",
    country: "IR",
    numberingSystem: "arabext",
  } as const;
  expect(
    resolveAccountLocalePreferences({
      saved,
      profileTimeZone: "UTC",
      fallback: { timeZone: "Europe/Berlin", country: "DE", locale: "de" },
    }),
  ).toEqual({ ...saved, timeZone: "Europe/Berlin" });
  expect(
    resolveAccountLocalePreferences({
      saved: { ...saved, timeZone: "Asia/Tehran" },
      profileTimeZone: "Europe/London",
      fallback: { timeZone: "Invalid/Zone" },
    }).timeZone,
  ).toBe("Asia/Tehran");
  expect(
    resolveAccountLocalePreferences({
      saved: { ...saved, timeZone: "Asia/Tehran" },
      profileTimeZone: "Asia/Tehran",
      fallback: { timeZone: "+05:30" },
    }).timeZone,
  ).toBe("Asia/Tehran");
});

it("preserves explicit manual UTC and legacy non-UTC profile overrides", () => {
  const saved = {
    locale: "en",
    calendar: "gregory",
    timeZone: "UTC",
    timeZoneMode: "manual",
  } as const;
  expect(
    resolveAccountLocalePreferences({
      saved,
      profileTimeZone: "UTC",
      fallback: { timeZone: "Asia/Tehran", timeZoneMode: "browser" },
    }),
  ).toEqual(saved);
  expect(
    resolveAccountLocalePreferences({
      saved: { locale: "en", calendar: "gregory", timeZone: "Asia/Tehran" },
      profileTimeZone: "Europe/Berlin",
      fallback: { timeZone: "America/New_York" },
    }).timeZone,
  ).toBe("Europe/Berlin");
  expect(
    resolveAccountLocalePreferences({
      profileTimeZone: "Europe/London",
      fallback: { timeZone: "Asia/Tehran", timeZoneMode: "browser" },
    }),
  ).toEqual({ locale: "en", calendar: "gregory", timeZone: "Europe/London" });
});
