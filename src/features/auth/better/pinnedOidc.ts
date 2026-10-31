import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { oidcProviderId } from "./providers";

function requestedProvider(ctx: {
  path?: string;
  body?: unknown;
  params?: unknown;
}): string | null {
  const path = ctx.path ?? "";
  if (path.startsWith("/callback/")) {
    const params = ctx.params;
    if (
      typeof params === "object" &&
      params !== null &&
      "id" in params &&
      typeof params.id === "string"
    )
      return params.id;
    return path.slice("/callback/".length);
  }
  if (path !== "/sign-in/social" && path !== "/link-social") return null;
  const body = ctx.body;
  return typeof body === "object" &&
    body !== null &&
    "provider" in body &&
    typeof body.provider === "string"
    ? body.provider
    : null;
}

// Place immediately AFTER genericOAuth. Its init and retry hook cache the exact metadata used
// by native token verification; checking that registry avoids a separate discovery fetch race.
export function pinnedOidcPlugin(providers: readonly { issuer: string }[]): BetterAuthPlugin {
  const expectedIssuers = new Map(providers.map(({ issuer }) => [oidcProviderId(issuer), issuer]));
  return {
    id: "warpdrive-pinned-oidc",
    init: (ctx) => ({
      context: {
        socialProviders: ctx.socialProviders.filter((provider) => {
          const issuer = expectedIssuers.get(provider.id);
          return issuer === undefined || provider.issuer === issuer;
        }),
      },
    }),
    hooks: {
      before: [
        {
          matcher: (ctx) => {
            const id = requestedProvider(ctx);
            return id !== null && expectedIssuers.has(id);
          },
          handler: createAuthMiddleware((ctx) =>
            Promise.resolve().then(() => {
              const id = requestedProvider(ctx);
              if (id === null) return;
              const issuer = expectedIssuers.get(id);
              const provider = ctx.context.socialProviders.find((entry) => entry.id === id);
              if (issuer === undefined || provider?.issuer !== issuer) {
                throw new APIError("BAD_REQUEST", {
                  code: "OIDC_ISSUER_MISMATCH",
                  message: "The identity provider configuration could not be verified",
                });
              }
            }),
          ),
        },
      ],
    },
  };
}
