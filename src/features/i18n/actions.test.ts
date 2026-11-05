import { afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  set: vi.fn(),
  remove: vi.fn(),
  guard: vi.fn(() => Promise.resolve({ ok: true })),
  context: vi.fn(() => Promise.resolve({ actor: { id: "user-1" } })),
  write: vi.fn(() => Promise.resolve()),
}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ set: h.set, delete: h.remove }),
}));
vi.mock("@/config/env", () => ({ env: { BASE_URL: "https://localhost" } }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: h.guard }));
vi.mock("@/server/trpc/context", () => ({ createContext: h.context }));
vi.mock("@/features/identity/preferencesRepo", () => ({ setPreferences: h.write }));

import { saveLocalePreferencesAction } from "./actions";
import { COUNTRY_COOKIE, TIME_ZONE_COOKIE, TIME_ZONE_MODE_COOKIE } from "./preferences";

afterEach(() => vi.clearAllMocks());

it.each(["browser", "manual"] as const)(
  "persists the effective zone and country for %s mode, including the worker scalar",
  async (timeZoneMode) => {
    const preferences = {
      locale: "en",
      calendar: "gregory",
      timeZone: timeZoneMode === "browser" ? "Asia/Tehran" : "UTC",
      country: "IR",
      timeZoneMode,
    } as const;
    expect(await saveLocalePreferencesAction(preferences, "csrf")).toEqual({ ok: true });
    expect(h.guard).toHaveBeenCalledWith("csrf");
    expect(h.write).toHaveBeenCalledWith(
      {},
      "user-1",
      { timezone: preferences.timeZone, ui: { localePreferences: preferences } },
      expect.any(AbortSignal),
    );
    expect(h.set).toHaveBeenCalledWith(
      COUNTRY_COOKIE,
      "IR",
      expect.objectContaining({ secure: true }),
    );
    expect(h.set).toHaveBeenCalledWith(TIME_ZONE_COOKIE, preferences.timeZone, expect.any(Object));
    expect(h.set).toHaveBeenCalledWith(TIME_ZONE_MODE_COOKIE, timeZoneMode, expect.any(Object));
  },
);

it("clears optional cookie mirrors without retaining a previous country or mode", async () => {
  expect(
    await saveLocalePreferencesAction(
      { locale: "en", calendar: "gregory", timeZone: "UTC" },
      "csrf",
    ),
  ).toEqual({ ok: true });
  expect(h.remove).toHaveBeenCalledWith(COUNTRY_COOKIE);
  expect(h.remove).toHaveBeenCalledWith(TIME_ZONE_MODE_COOKIE);
});

it("rejects invalid regions and denied CSRF before preference or cookie writes", async () => {
  const preferences = { locale: "en", calendar: "gregory", timeZone: "UTC" } as const;
  expect(await saveLocalePreferencesAction({ ...preferences, country: "ZZ" }, "csrf")).toEqual({
    ok: false,
    error: "invalid",
  });
  h.guard.mockResolvedValueOnce({ ok: false });
  expect(await saveLocalePreferencesAction(preferences, null)).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(h.write).not.toHaveBeenCalled();
  expect(h.set).not.toHaveBeenCalled();
});
