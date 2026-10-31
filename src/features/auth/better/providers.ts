import { createHash } from "node:crypto";
import type { Env } from "@/config/env";
import type { AuthProviders } from "./contracts";

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
