import { expect, test, vi } from "vitest";

const selected = vi.hoisted(() => ({ locale: "en" }));
vi.mock("@/features/i18n/server", () => ({
  getLocalePreferences: () => Promise.resolve({ locale: selected.locale }),
}));
vi.mock("@/features/privacy/ui/PersonalPrivacyWorkspace", () => ({
  PersonalPrivacyWorkspace: () => null,
}));

import { PersonalPrivacyWorkspace } from "@/features/privacy/ui/PersonalPrivacyWorkspace";
import PrivacyCasePage, { generateMetadata } from "./page";

test("passes only a validated opaque selector to the private client workspace", async () => {
  const caseId = "00000000-0000-4000-8000-000000000031";
  expect(await PrivacyCasePage({ params: Promise.resolve({ caseId }) })).toMatchObject({
    type: PersonalPrivacyWorkspace,
    props: { caseId },
  });
});

test.each(["", "../private", "PRIVATE-person@example.test", "not-an-id"])(
  "invalid selector %s terminates through the framework's generic not-found boundary",
  async (caseId) => {
    await expect(PrivacyCasePage({ params: Promise.resolve({ caseId }) })).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
  },
);

test.each([
  ["en", "Privacy requests"],
  ["de", "Datenschutzanfragen"],
  ["fa", "درخواست‌های حریم خصوصی"],
] as const)("keeps %s metadata generic and localized", async (locale, title) => {
  selected.locale = locale;
  expect(await generateMetadata()).toEqual({ title });
});
