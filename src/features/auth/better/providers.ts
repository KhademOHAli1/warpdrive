import { createHash } from "node:crypto";
import type { GoogleOptions } from "better-auth/social-providers";
import type { Env } from "@/config/env";
import type { AuthProviders } from "./contracts";

export function googleProviderOptions(
  config: Pick<
    Env,
    "GOOGLE_OAUTH_CLIENT_ID" | "GOOGLE_OAUTH_CLIENT_SECRET" | "GOOGLE_WORKSPACE_DOMAIN"
  >,
): GoogleOptions {
  const domain = config.GOOGLE_WORKSPACE_DOMAIN.trim().toLowerCase();
  return {
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    scope: ["openid", "email", "profile"],
    // Better Auth checks this against Google's verified hosted-domain claim as well as
    // sending it as an account-selection hint. Blank keeps public deployments unrestricted.
    ...(domain ? { hd: domain } : {}),
  };
}

export function oidcProviderId(issuer: string): string {
  return `oidc-${createHash("sha256").update(issuer.replace(/\/$/, "")).digest("hex").slice(0, 16)}`;
}

export function authProviders(config: Env): AuthProviders {
  return {
    emailPassword: config.AUTH_ALLOW_PASSWORD,
    passkeys: config.AUTH_ALLOW_PASSKEY,
    providers: [
      ...(config.AUTH_GOOGLE_ENABLED &&
      config.GOOGLE_OAUTH_CLIENT_ID &&
      config.GOOGLE_OAUTH_CLIENT_SECRET
        ? [{ id: "google", name: "Google" }]
        : []),
      ...(config.AUTH_MICROSOFT_CLIENT_ID && config.AUTH_MICROSOFT_CLIENT_SECRET
        ? [{ id: "microsoft", name: "Microsoft" }]
        : []),
      ...config.AUTH_OIDC_PROVIDERS.map((provider) => ({
        id: oidcProviderId(provider.issuer),
        name: provider.name,
      })),
    ],
  };
}
