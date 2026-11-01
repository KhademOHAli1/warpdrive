import { expect, it, vi } from "vitest";

const selected = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/features/i18n/server", () => ({
  getLocalePreferences: () => Promise.resolve({ locale: selected.locale }),
}));
vi.mock("@/features/privacy/ui/PersonalPrivacyWorkspace", () => ({
  PersonalPrivacyWorkspace: () => null,
}));

import { generateMetadata } from "./page";

it.each([
  ["en", "Privacy requests"],
  ["de", "Datenschutzanfragen"],
  ["fa", "درخواست‌های حریم خصوصی"],
] as const)(
  "localizes the %s personal request route title on the server",
  async (locale, title) => {
    selected.locale = locale;
    expect(await generateMetadata()).toEqual({ title });
  },
);
