// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { SecurityStatus } from "../better/contracts";
import { ContinueScreen } from "./ContinueScreen";
import { LAST_SIGN_IN_METHOD_COOKIE, readLastSignInMethod } from "./signInMethod";

const { state, replace } = vi.hoisted(() => ({
  state: { status: null as SecurityStatus | null },
  replace: vi.fn(),
}));
const config = {
  emailPassword: true,
  passkeys: true,
  providers: [{ id: "google", name: "Google" }],
};
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("./useAccountStatus", () => ({
  useAccountStatus: () => ({ status: state.status, error: null, refresh: vi.fn() }),
  useAuthProviders: () => ({ config, error: false, retry: vi.fn() }),
}));
vi.mock("./MfaPanel", () => ({ MfaPanel: () => <div>MFA required</div> }));
vi.mock("./FreshVerification", () => ({ FreshVerification: () => <div>Fresh verification</div> }));

const complete: SecurityStatus = {
  authenticated: true,
  user: { id: "user", name: "Person", email: "person@example.test", isAdmin: false },
  emailVerified: true,
  hasPassword: true,
  twoFactorEnabled: false,
  needsMfa: false,
  needsEnrollment: false,
  fresh: true,
  authMethod: "google",
  policy: { requireMfaForAll: false, idleMinutes: 20160, absoluteHours: 336, freshMinutes: 5 },
  accounts: [],
  passkeys: [],
  sessions: [],
  recoveryCodesAvailable: false,
  audit: [],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // biome-ignore lint/suspicious/noDocumentCookie: reset the actual non-secret preference between browser-unit cases.
  document.cookie = `${LAST_SIGN_IN_METHOD_COOKIE}=; Path=/; Max-Age=0`;
});

it.each([{ needsMfa: true }, { needsEnrollment: true }, { emailVerified: false }])(
  "does not remember a sign-in before required verification is complete: %j",
  (pending) => {
    state.status = { ...complete, ...pending };
    render(
      <LocaleProvider locale="en">
        <ContinueScreen />
      </LocaleProvider>,
    );
    expect(readLastSignInMethod(config)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  },
);

it("remembers only after the server reports a completed authenticated session", () => {
  state.status = complete;
  render(
    <LocaleProvider locale="en">
      <ContinueScreen returnTo="/campaigns" />
    </LocaleProvider>,
  );
  expect(readLastSignInMethod(config)).toBe("google");
  expect(replace).toHaveBeenCalledWith("/campaigns");
});
