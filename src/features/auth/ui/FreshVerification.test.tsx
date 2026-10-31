// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { SecurityStatus } from "../better/contracts";
import { FreshVerification } from "./FreshVerification";

const { verifyTotp, signInSocial, retryProviders, providerConfig } = vi.hoisted(() => ({
  verifyTotp: vi.fn(),
  signInSocial: vi.fn(),
  retryProviders: vi.fn(),
  providerConfig: { providers: [] as { id: string; name: string }[], failed: false },
}));
vi.mock("../better/client", () => ({
  authClient: { twoFactor: { verifyTotp }, signIn: { passkey: vi.fn(), social: signInSocial } },
}));
vi.mock("./useAccountStatus", () => ({
  useAuthProviders: () => ({
    config: providerConfig.failed
      ? null
      : { providers: providerConfig.providers, emailPassword: true, passkeys: true },
    error: providerConfig.failed,
    retry: retryProviders,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  providerConfig.providers = [];
  providerConfig.failed = false;
});
const status: SecurityStatus = {
  authenticated: true,
  user: { id: "u", name: "Ali", email: "ali@example.com", isAdmin: true },
  emailVerified: true,
  hasPassword: true,
  twoFactorEnabled: true,
  needsMfa: false,
  needsEnrollment: false,
  fresh: false,
  authMethod: "password",
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 12, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: true,
  audit: [],
};
it("requires a fresh factor for administrators instead of offering password-only confirmation", async () => {
  verifyTotp.mockResolvedValue({ data: {}, error: null });
  const refresh = vi.fn();
  render(
    <LocaleProvider locale="de">
      <FreshVerification status={status} refresh={refresh} />
    </LocaleProvider>,
  );
  expect(screen.queryByLabelText("Aktuelles Passwort")).toBeNull();
  fireEvent.change(screen.getByLabelText("Authenticator-Code"), { target: { value: "۰۰۱۲۳۴" } });
  fireEvent.click(screen.getByRole("button", { name: "Code bestätigen" }));
  await waitFor(() => expect(verifyTotp).toHaveBeenCalledWith({ code: "001234" }));
  expect(refresh).toHaveBeenCalledOnce();
});

it("does not offer password-only factor changes to a regular account with an enrolled passkey", () => {
  render(
    <LocaleProvider locale="de">
      <FreshVerification
        status={{
          ...status,
          user: { ...status.user, isAdmin: false },
          twoFactorEnabled: false,
          passkeys: [
            {
              id: "key",
              name: "Device",
              createdAt: "2026-10-31T08:00:00Z",
              deviceType: "singleDevice",
              backedUp: false,
            },
          ],
        }}
        refresh={vi.fn()}
      />
    </LocaleProvider>,
  );
  expect(screen.queryByLabelText("Aktuelles Passwort")).toBeNull();
  expect(screen.getByRole("button", { name: "Mit Passkey bestätigen" })).toBeInTheDocument();
});

for (const [returnTo, expected] of [
  [undefined, "/auth/continue?returnTo=/settings/security"],
  ["/settings/email-sync", "/auth/continue?returnTo=%2Fsettings%2Femail-sync"],
  ["https://outside.example/path", "/auth/continue?returnTo=%2Fpipeline"],
  ["//outside.example/path", "/auth/continue?returnTo=%2Fpipeline"],
  ["/%2Foutside.example/path", "/auth/continue?returnTo=%2Fpipeline"],
  ["/%255Coutside.example/path", "/auth/continue?returnTo=%2Fpipeline"],
  ["/%61uth/continue", "/auth/continue?returnTo=%2Fpipeline"],
] as const) {
  it(`keeps social reauthentication return destinations safe: ${String(returnTo)}`, async () => {
    providerConfig.providers = [{ id: "google", name: "Google" }];
    signInSocial.mockResolvedValue({ data: {}, error: null });
    render(
      <LocaleProvider locale="de">
        <FreshVerification
          status={{
            ...status,
            accounts: [{ id: "google-account", providerId: "google", accountId: "subject" }],
          }}
          returnTo={returnTo}
          refresh={vi.fn()}
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mit Google bestätigen" }));
    await waitFor(() =>
      expect(signInSocial).toHaveBeenCalledWith({ provider: "google", callbackURL: expected }),
    );
  });
}

it("offers recovery when method discovery fails for a passkey-only account", () => {
  providerConfig.failed = true;
  render(
    <LocaleProvider locale="de">
      <FreshVerification
        status={{
          ...status,
          user: { ...status.user, isAdmin: false },
          hasPassword: false,
          twoFactorEnabled: false,
          passkeys: [
            {
              id: "key",
              name: "Device",
              createdAt: "2026-10-31T08:00:00Z",
              deviceType: "singleDevice",
              backedUp: false,
            },
          ],
        }}
        refresh={vi.fn()}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("alert")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  expect(retryProviders).toHaveBeenCalledOnce();
});
