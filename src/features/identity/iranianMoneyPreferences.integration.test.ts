import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { seedUser } from "@/db/testing/factories";
import { resolveAccountLocalePreferences } from "@/features/i18n/accountPreferences";
import { getPreferences, setPreferences } from "./preferencesRepo";

it("stores the Iranian display unit independently of locale and other profile preferences", async () => {
  await withTestDb(async (db) => {
    const user = await seedUser(db);
    const signal = AbortSignal.timeout(10_000);
    await setPreferences(
      db,
      user.id,
      {
        ui: {
          winSound: true,
          localePreferences: {
            locale: "fa",
            calendar: "persian",
            timeZone: "Asia/Tehran",
            iranianMoneyUnit: "toman",
          },
        },
      },
      signal,
    );
    const saved = await getPreferences(db, user.id, signal);
    expect(saved.ui.localePreferences?.iranianMoneyUnit).toBe("toman");
    const next = { ...saved.ui.localePreferences!, locale: "de" as const };
    await setPreferences(db, user.id, { ui: { localePreferences: next } }, signal);
    const reloaded = await getPreferences(db, user.id, signal);
    expect(reloaded.ui.winSound).toBe(true);
    expect(
      resolveAccountLocalePreferences({
        saved: reloaded.ui.localePreferences,
        profileTimeZone: null,
        fallback: { locale: "en", iranianMoneyUnit: "rial" },
      }),
    ).toEqual({
      locale: "de",
      calendar: "persian",
      timeZone: "Asia/Tehran",
      iranianMoneyUnit: "toman",
    });
  });
});
