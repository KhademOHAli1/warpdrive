import { describe, expect, test } from "vitest";
import { testEnvInput } from "@/test/envInput";
import { parseEnv } from "./env";

describe("Better Auth deployment boundary", () => {
  test("invalid provider and production URLs return validation failures", () => {
    expect(parseEnv({ ...testEnvInput(), NODE_ENV: "production", BASE_URL: "not-a-url" }).ok).toBe(
      false,
    );
    expect(
      parseEnv({
        ...testEnvInput(),
        AUTH_OIDC_PROVIDERS: JSON.stringify([
          { name: "SSO", issuer: "not-a-url", clientId: "id", clientSecret: "secret" },
        ]),
      }).ok,
    ).toBe(false);
  });
  test("requires HTTPS for production authentication while permitting local development HTTP", () => {
    const production = {
      ...testEnvInput(),
      NODE_ENV: "production" as const,
      SEED_ADMIN_EMAIL: "admin@example.com",
      AUTH_SECRET: "test-only-strong-production-secret-over-thirty-two-characters",
      AUTH_MAIL_TRANSPORT: "smtp",
      AUTH_SMTP_HOST: "smtp.example.invalid",
    };
    expect(parseEnv({ ...production, BASE_URL: "http://app.example.com" }).ok).toBe(false);
    expect(parseEnv({ ...production, BASE_URL: "https://app.example.com" }).ok).toBe(true);
    expect(
      parseEnv({ ...production, NODE_ENV: "development", BASE_URL: "http://localhost:3104" }).ok,
    ).toBe(true);
  });
  test("requires a dedicated production secret", () => {
    const result = parseEnv({
      ...testEnvInput(),
      NODE_ENV: "production",
      SEED_ADMIN_EMAIL: "admin@example.com",
      AUTH_SECRET: "",
    });
    expect(result.ok).toBe(false);
  });
  test("rejects malformed or insecure configured OIDC providers", () => {
    for (const value of [
      "bad-json",
      JSON.stringify([
        {
          name: "SSO",
          issuer: "http://identity.example.com",
          clientId: "id",
          clientSecret: "secret",
        },
      ]),
    ]) {
      expect(parseEnv({ ...testEnvInput(), AUTH_OIDC_PROVIDERS: value }).ok).toBe(false);
    }
  });
  test("supports a non-Google installation and typed secure mail configuration", () => {
    const result = parseEnv({
      ...testEnvInput(),
      GOOGLE_OAUTH_CLIENT_ID: "",
      GOOGLE_OAUTH_CLIENT_SECRET: "",
      GOOGLE_WORKSPACE_DOMAIN: "",
      AUTH_MAIL_TRANSPORT: "capture",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.AUTH_MAIL_TRANSPORT).toBe("capture");
  });
});
