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
