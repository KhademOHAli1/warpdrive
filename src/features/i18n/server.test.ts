import { beforeEach, expect, it, vi } from "vitest";
import type { Preferences } from "@/features/identity/preferencesSchema";

const h = vi.hoisted((): { values: Record<string, string>; preferences: Preferences } => ({
  values: {},
  preferences: { timezone: null, density: "comfortable", ui: {} },
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (key: string) => (h.values[key] === undefined ? undefined : { value: h.values[key] }),
    }),
}));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/auth/session", () => ({ SESSION_COOKIE: "wd_session" }));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: { id: "user-1" } }),
}));
vi.mock("@/features/identity/preferencesForActor", () => ({
  getPreferencesForActor: () => Promise.resolve(h.preferences),
}));

import {
  CALENDAR_COOKIE,
  COUNTRY_COOKIE,
  LOCALE_COOKIE,
  NUMBERING_SYSTEM_COOKIE,
  TIME_ZONE_COOKIE,
  TIME_ZONE_MODE_COOKIE,
} from "./preferences";
import { getLocalePreferences } from "./server";

beforeEach(() => {
  h.values = {};
  h.preferences = { timezone: null, density: "comfortable", ui: {} };
});

it("offers ephemeral browser defaults only when there are no established choices", async () => {
  expect(await getLocalePreferences()).toMatchObject({
    locale: "en",
    timeZone: "UTC",
    inferBrowserLanguage: true,
    inferBrowserFormats: true,
  });
  h.values = {
    [LOCALE_COOKIE]: "de",
    [CALENDAR_COOKIE]: "persian",
    [NUMBERING_SYSTEM_COOKIE]: "arabext",
  };
  expect(await getLocalePreferences()).toMatchObject({
    locale: "de",
    calendar: "persian",
    numberingSystem: "arabext",
    inferBrowserLanguage: false,
    inferBrowserFormats: false,
  });
});

it("reads country and automatic mode cookies for guests", async () => {
  h.values = {
    [LOCALE_COOKIE]: "fa",
    [COUNTRY_COOKIE]: "DE",
    [TIME_ZONE_COOKIE]: "Europe/Berlin",
    [TIME_ZONE_MODE_COOKIE]: "browser",
  };
  expect(await getLocalePreferences()).toMatchObject({
    locale: "fa",
    country: "DE",
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
    timeZoneMode: "browser",
  });
});

it("keeps account choices and uses the current device cookie for a browser-mode zone", async () => {
  h.values = {
    wd_session: "session",
    [LOCALE_COOKIE]: "de",
    [COUNTRY_COOKIE]: "DE",
    [TIME_ZONE_COOKIE]: "Europe/Berlin",
    [TIME_ZONE_MODE_COOKIE]: "browser",
  };
  h.preferences = {
    timezone: "UTC",
    density: "comfortable",
    ui: {
      localePreferences: {
        locale: "en",
        calendar: "persian",
        numberingSystem: "latn",
        country: "IR",
        timeZone: "UTC",
        timeZoneMode: "browser",
      },
    },
  };
  expect(await getLocalePreferences()).toMatchObject({
    locale: "en",
    country: "IR",
    calendar: "persian",
    numberingSystem: "latn",
    timeZone: "Europe/Berlin",
    timeZoneMode: "browser",
    inferBrowserLanguage: false,
    inferBrowserFormats: false,
  });
});
