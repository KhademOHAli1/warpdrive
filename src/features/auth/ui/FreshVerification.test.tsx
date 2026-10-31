// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { SecurityStatus } from "../better/contracts";
import { FreshVerification } from "./FreshVerification";

const { verifyTotp } = vi.hoisted(() => ({ verifyTotp: vi.fn() }));
vi.mock("../better/client", () => ({
  authClient: { twoFactor: { verifyTotp }, signIn: { passkey: vi.fn(), social: vi.fn() } },
}));
vi.mock("./useAccountStatus", () => ({
  useAuthProviders: () => ({ config: { providers: [], emailPassword: true, passkeys: true } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
