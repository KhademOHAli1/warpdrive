// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ok } from "@/types/result";
import { fill, receipt, send, show } from "./OwnPrivacyRequestFormTestKit";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../requestActions", () => ({ createOwnPrivacyRequestAction: mocks.create }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/auth/ui/useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: false } }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockResolvedValue(ok(receipt));
});
afterEach(cleanup);

test.each([
  ["en", "View request status"],
  ["de", "Anfragestatus ansehen"],
  ["fa", "مشاهده وضعیت درخواست"],
] as const)("offers a persistent opaque reference after receipt in %s", async (locale, label) => {
  show(locale);
  fill(locale);
  send(locale);
  const link = await screen.findByRole("link", { name: label }, { timeout: 1000 });
  expect(link).toHaveAttribute("href", `/settings/privacy/requests/${receipt.id}`);
  expect(link.getAttribute("href")).not.toContain("?");
  expect(mocks.create).toHaveBeenCalledOnce();
});
