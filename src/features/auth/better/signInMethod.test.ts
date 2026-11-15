import { describe, expect, it } from "vitest";
import { sessionSignInMethod } from "./signInMethod";

describe("primary session method", () => {
  it("derives password and verified passkey methods from the actual endpoint", () => {
    expect(sessionSignInMethod("/sign-in/email", "google", null)).toBe("password");
    expect(sessionSignInMethod("/passkey/verify-authentication", null, null)).toBe("passkey");
  });
  it("retains a social method when MFA completes and defaults native password MFA correctly", () => {
    expect(sessionSignInMethod("/two-factor/verify-totp", null, "google")).toBe("google");
    expect(sessionSignInMethod("/two-factor/verify-backup-code", null, undefined)).toBe("password");
    expect(sessionSignInMethod("/callback/microsoft", null, null)).toBe("microsoft");
    expect(sessionSignInMethod("/oauth2/callback/oidc_example", null, null)).toBe("oidc_example");
  });
});
