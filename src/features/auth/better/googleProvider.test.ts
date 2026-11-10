import { google } from "better-auth/social-providers";
import { UnsecuredJWT } from "jose";
import { describe, expect, test } from "vitest";
import { googleProviderOptions } from "./providers";

function configuredGoogle(domain = "example.com") {
  return google(
    googleProviderOptions({
      GOOGLE_OAUTH_CLIENT_ID: "test-google-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "test-google-secret",
      GOOGLE_WORKSPACE_DOMAIN: domain,
    }),
  );
}

// These fixtures exercise the SDK's post-verification profile gate, not JWT signature
// verification or an authenticated session. No Google requests or database are involved.
function profileToken(domain?: string) {
  return new UnsecuredJWT({
    sub: "test-google-user",
    name: "Test User",
    email: "user@example.com",
    email_verified: true,
    ...(domain === undefined ? {} : { hd: domain }),
  }).encode();
}

describe("native Google Workspace provider", () => {
  test("passes the normalized domain to the native authorization URL with identity-only scopes", async () => {
    const provider = configuredGoogle(" Example.COM ");
    const url = await provider.createAuthorizationURL({
      state: "test-state",
      codeVerifier: "test-code-verifier-with-more-than-43-characters",
      redirectURI: "https://crm.example.com/api/auth/callback/google",
    });
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("hd")).toBe("example.com");
    expect(url.searchParams.get("client_id")).toBe("test-google-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://crm.example.com/api/auth/callback/google",
    );
    expect(new Set(url.searchParams.get("scope")?.split(" "))).toEqual(
      new Set(["openid", "email", "profile"]),
    );
  });

  test("accepts the exact hosted domain in the native ID-token claim gate", () => {
    const provider = configuredGoogle(" Example.COM ");
    expect(provider.idToken.verifyClaims?.({ hd: "example.com" })).toBe(true);
  });

  test.each(["other.example", "example.com.attacker.example", undefined])(
    "rejects a wrong or missing hosted domain %s despite a matching email suffix",
    (domain) => {
      const provider = configuredGoogle();
      expect(provider.idToken.verifyClaims?.({ email: "user@example.com", hd: domain })).toBe(
        false,
      );
    },
  );

  test("accepts the exact hosted domain in the native callback profile gate", async () => {
    const provider = configuredGoogle(" Example.COM ");
    const result = await provider.getUserInfo({ idToken: profileToken("example.com") });
    expect(result?.user.email).toBe("user@example.com");
    expect(result?.user.emailVerified).toBe(true);
  });

  test.each(["other.example", undefined])(
    "rejects callback profiles from the wrong or missing hosted domain %s",
    async (domain) => {
      const provider = configuredGoogle();
      expect(await provider.getUserInfo({ idToken: profileToken(domain) })).toBeNull();
    },
  );

  test("retains public Google login when no hosted domain is configured", async () => {
    const provider = configuredGoogle(" \t ");
    expect(provider.options.hd).toBeUndefined();
    expect(provider.idToken.verifyClaims).toBeUndefined();
    expect((await provider.getUserInfo({ idToken: profileToken() }))?.user.email).toBe(
      "user@example.com",
    );
  });
});
