// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { SecurityStatus } from "../better/contracts";
import { FreshVerification } from "./FreshVerification";

const mocks = vi.hoisted(() => ({ social: vi.fn(), passkey: vi.fn() }));
vi.mock("../better/client", () => ({
  authClient: {
    twoFactor: { verifyTotp: vi.fn() },
    signIn: { passkey: mocks.passkey, social: mocks.social },
  },
}));
vi.mock("./useAccountStatus", () => ({
  useAuthProviders: () => ({
    config: { providers: [{ id: "google", name: "Google" }], emailPassword: true, passkeys: true },
  }),
}));
const status: SecurityStatus = {
  authenticated: true,
  user: { id: "synthetic-user", name: "Synthetic", email: "user@example.test", isAdmin: false },
  emailVerified: true,
  hasPassword: false,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
  fresh: false,
  authMethod: "oidc",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [{ id: "linked", providerId: "google", accountId: "synthetic-provider-user" }],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.social.mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

it.each([
  ["en", "Confirm identity in a new tab"],
  ["de", "Identität in neuem Tab bestätigen"],
  ["fa", "تأیید هویت در برگهٔ جدید"],
] satisfies [Locale, string][])(
  "keeps the %s caller in place while offering existing Security confirmation",
  (locale, label) => {
    render(
      <LocaleProvider locale={locale}>
        <textarea aria-label="Private draft" defaultValue="PRIVATE-DRAFT-SENTINEL" />
        <FreshVerification
          status={status}
          refresh={vi.fn()}
          providerConfirmation="new_tab"
          returnTo="//outside.example/PRIVATE-DRAFT-SENTINEL"
          embedded
        />
      </LocaleProvider>,
    );
    const link = screen.getByRole("link", { name: label });
    expect(link).toHaveAttribute("href", "/settings/security");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
    expect(link.getAttribute("href")).not.toMatch(/PRIVATE|synthetic|returnTo|token/);
    expect(screen.queryByRole("button", { name: /Google/u })).toBeNull();
    expect(screen.getByLabelText("Private draft")).toHaveValue("PRIVATE-DRAFT-SENTINEL");
    expect(mocks.social).not.toHaveBeenCalled();
  },
);

it("preserves the existing provider redirect by default", async () => {
  render(
    <LocaleProvider locale="en">
      <FreshVerification status={status} refresh={vi.fn()} />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm with Google" }));
  await waitFor(() =>
    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/auth/continue?returnTo=/settings/security",
    }),
  );
});

it("offers no provider confirmation link for an unlinked provider", () => {
  render(
    <LocaleProvider locale="en">
      <FreshVerification
        status={{ ...status, accounts: [] }}
        refresh={vi.fn()}
        providerConfirmation="new_tab"
      />
    </LocaleProvider>,
  );
  expect(screen.queryByRole("link", { name: "Confirm identity in a new tab" })).toBeNull();
  expect(mocks.social).not.toHaveBeenCalled();
});

it("prevents a second confirmation flow while an inline factor is pending", async () => {
  let finish: ((value: { data: object; error: null }) => void) | undefined;
  mocks.passkey.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <LocaleProvider locale="en">
      <FreshVerification
        status={{
          ...status,
          passkeys: [
            {
              id: "key",
              name: "Synthetic",
              createdAt: "2026-11-01T00:00:00Z",
              deviceType: "singleDevice",
              backedUp: false,
            },
          ],
        }}
        refresh={vi.fn()}
        providerConfirmation="new_tab"
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm with passkey" }));
  const link = screen.getByRole("link", { name: "Confirm identity in a new tab" });
  await waitFor(() => expect(link).toHaveAttribute("aria-disabled", "true"));
  expect(link).toHaveAttribute("tabindex", "-1");
  expect(fireEvent.click(link)).toBe(false);
  finish?.({ data: {}, error: null });
});
