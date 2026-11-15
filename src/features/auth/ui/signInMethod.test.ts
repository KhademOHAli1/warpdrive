// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  availableSignInMethod,
  LAST_SIGN_IN_METHOD_COOKIE,
  readLastSignInMethod,
  rememberSignInMethod,
} from "./signInMethod";

const config = {
  emailPassword: true,
  passkeys: true,
  providers: [{ id: "google", name: "Google" }],
};
afterEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: clear the browser-unit fixture's non-secret preference.
  document.cookie = `${LAST_SIGN_IN_METHOD_COOKIE}=; Path=/; Max-Age=0`;
});

describe("device-local sign-in preference", () => {
  it("remembers only a method and recovers the last successful choice", () => {
    rememberSignInMethod("google", config);
    expect(readLastSignInMethod(config)).toBe("google");
    expect(document.cookie).toContain(`${LAST_SIGN_IN_METHOD_COOKIE}=google`);
    expect(document.cookie).not.toContain("@");
    rememberSignInMethod("password", config);
    expect(readLastSignInMethod(config)).toBe("email");
    rememberSignInMethod("passkey", config);
    expect(readLastSignInMethod(config)).toBe("passkey");
  });
  it("ignores disabled, removed, malformed and pending choices", () => {
    rememberSignInMethod("google", config);
    expect(readLastSignInMethod({ ...config, providers: [] })).toBeNull();
    expect(availableSignInMethod("passkey", { ...config, passkeys: false })).toBeNull();
    expect(availableSignInMethod("password", { ...config, emailPassword: false })).toBeNull();
    // biome-ignore lint/suspicious/noDocumentCookie: exercise malformed cookie input using the real browser-cookie parser.
    document.cookie = `${LAST_SIGN_IN_METHOD_COOKIE}=%broken; Path=/`;
    expect(readLastSignInMethod(config)).toBeNull();
    // biome-ignore lint/suspicious/noDocumentCookie: reset the real browser-cookie fixture before checking rejected writes.
    document.cookie = `${LAST_SIGN_IN_METHOD_COOKIE}=; Path=/; Max-Age=0`;
    rememberSignInMethod("pending");
    expect(readLastSignInMethod(config)).toBeNull();
    rememberSignInMethod("google; Domain=example.com");
    expect(readLastSignInMethod(config)).toBeNull();
  });
  it("maps completed factor and passkey routes to their usable login choices", () => {
    expect(availableSignInMethod("verify-totp", config)).toBe("email");
    expect(availableSignInMethod("verify-backup-code", config)).toBe("email");
    expect(availableSignInMethod("verify-authentication", config)).toBe("passkey");
  });
});
