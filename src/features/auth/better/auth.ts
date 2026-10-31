import { randomUUID } from "node:crypto";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { genericOAuth, twoFactor } from "better-auth/plugins";
import { type Env, env } from "@/config/env";
import type { Db } from "@/db/client";
import {
  authAccounts,
  authInvitations,
  authPasskeys,
  authRateLimits,
  authTwoFactors,
  authUsers,
  authVerifications,
  sessions,
} from "@/db/schema";
import { enqueueAuthMail } from "@/features/auth/management/mail";
import { rejectAuth, validateIncomingIdentity } from "./admission";
import { assurancePlugin } from "./assurancePlugin";
import { authDatabaseHooks } from "./databaseHooks";
import { emailVerificationPlugin, enqueueBoundVerificationMail } from "./emailVerification";
import { BLOCKED_AUTH_PATHS, guardAuthEndpoint } from "./endpointGuards";
import { hashSessionAdapter } from "./hashedAdapter";
import { hookBody } from "./hookBody";
import { authMailLocale } from "./mailLocale";
import { pinnedOidcPlugin } from "./pinnedOidc";
import { oidcProviderId } from "./providers";
import { enforceAuthRateLimit } from "./rateLimit";
import { createHashedBackupCodeStorage } from "./recoveryCodes";
import { recordNativeSecurityChange, securityChangePlugin } from "./securityChanges";
import { invitationStoragePlugin } from "./storagePlugin";
import { totpReplayPlugin } from "./totpReplay";

export function createBetterAuth(db: Db, config: Env = env) {
  const secure = new URL(config.BASE_URL).protocol === "https:";
  const send = async (
    user: { id: string; email: string },
    url: string,
    kind: "verification" | "password_reset",
    request?: Request,
  ) => {
    const input = {
      userId: user.id,
      recipient: user.email,
      url,
      kind,
      locale: await authMailLocale(db, user.id, request),
    };
    const signal = AbortSignal.timeout(10_000);
    if (kind === "verification")
      await enqueueBoundVerificationMail(
        db,
        input,
        config.AUTH_SECRET || config.TOKEN_ENCRYPTION_KEY,
        signal,
        request,
      );
    else await enqueueAuthMail(db, input, signal);
  };
  return betterAuth({
    appName: "Warpdrive",
    baseURL: config.BASE_URL,
    basePath: "/api/auth",
    secret: config.AUTH_SECRET || config.TOKEN_ENCRYPTION_KEY,
    trustedOrigins: [new URL(config.BASE_URL).origin],
    database: hashSessionAdapter(
      drizzleAdapter(db, {
        provider: "pg",
        transaction: true,
        schema: {
          user: authUsers,
          account: authAccounts,
          session: sessions,
          verification: authVerifications,
          twoFactor: authTwoFactors,
          passkey: authPasskeys,
          rateLimit: authRateLimits,
          invitation: authInvitations,
        },
      }),
      { revokedField: "revokedAt" },
    ),
    advanced: {
      // Keep production protections active in qualification runs as well. The SDK otherwise
      // disables origin checks automatically when it detects a test environment.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // Keep the existing host-only wd_sid name across local HTTP and production HTTPS.
      // Secure remains explicitly enforced on every native cookie in HTTPS deployments.
      useSecureCookies: false,
      defaultCookieAttributes: { secure, httpOnly: true, sameSite: "lax", path: "/" },
      database: { generateId: () => randomUUID() },
      cookies: {
        session_token: {
          name: "wd_sid",
          attributes: { httpOnly: true, secure, sameSite: "lax", path: "/" },
        },
      },
    },
    emailAndPassword: {
      enabled: config.AUTH_ALLOW_PASSWORD,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 900,
      sendResetPassword: ({ user, url }, request) => send(user, url, "password_reset", request),
      onPasswordReset: ({ user }, request) =>
        recordNativeSecurityChange(db, user, "password.reset", "password", request),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      expiresIn: 1800,
      sendVerificationEmail: ({ user, url }, request) => send(user, url, "verification", request),
    },
    socialProviders: {
      ...(config.AUTH_GOOGLE_ENABLED &&
      config.GOOGLE_OAUTH_CLIENT_ID &&
      config.GOOGLE_OAUTH_CLIENT_SECRET
        ? {
            google: {
              clientId: config.GOOGLE_OAUTH_CLIENT_ID,
              clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
              scope: ["openid", "email", "profile"],
            },
          }
        : {}),
      ...(config.AUTH_MICROSOFT_CLIENT_ID && config.AUTH_MICROSOFT_CLIENT_SECRET
        ? {
            microsoft: {
              clientId: config.AUTH_MICROSOFT_CLIENT_ID,
              clientSecret: config.AUTH_MICROSOFT_CLIENT_SECRET,
              tenantId: config.AUTH_MICROSOFT_TENANT,
            },
          }
        : {}),
    },
    user: {
      validateUserInfo: (input, ctx) => validateIncomingIdentity(db, input, ctx),
      changeEmail: {
        enabled: true,
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: ({ user, url }) => send(user, url, "verification"),
      },
      deleteUser: { enabled: false },
    },
    account: {
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        requireLocalEmailVerified: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    session: {
      fields: { token: "tokenHash" },
      expiresIn: 7 * 24 * 3600,
      freshAge: 300,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
      additionalFields: {
        authMethod: { type: "string", defaultValue: "pending", input: false, returned: false },
        assurance: { type: "string", defaultValue: "pending", input: false, returned: false },
        lastSeenAt: { type: "date", defaultValue: () => new Date(), input: false, returned: false },
        freshAuthenticatedAt: { type: "date", required: false, input: false, returned: false },
        mfaVerifiedAt: { type: "date", required: false, input: false, returned: false },
        revokedAt: { type: "date", required: false, input: false, returned: false },
      },
    },
    verification: { storeIdentifier: "hashed" },
    rateLimit: { enabled: false },
    disabledPaths: BLOCKED_AUTH_PATHS,
    databaseHooks: authDatabaseHooks(db),
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = hookBody(ctx.body);
        const subject = typeof body.email === "string" ? body.email.toLowerCase() : undefined;
        if (
          !(await enforceAuthRateLimit(
            db,
            new Headers(ctx.headers),
            ctx.path,
            subject,
            AbortSignal.timeout(5000),
          ))
        )
          throw new APIError("TOO_MANY_REQUESTS", {
            code: "RATE_LIMITED",
            message: "Please try again later",
          });
        await guardAuthEndpoint(db, ctx);
      }),
    },
    plugins: [
      invitationStoragePlugin,
      twoFactor({
        issuer: "Warpdrive",
        allowPasswordless: true,
        twoFactorCookieMaxAge: 300,
        skipVerificationOnEnable: false,
        backupCodeOptions: {
          storeBackupCodes: createHashedBackupCodeStorage(),
          amount: 10,
          length: 16,
        },
      }),
      ...(config.AUTH_ALLOW_PASSKEY
        ? [
            passkey({
              rpID: new URL(config.BASE_URL).hostname,
              rpName: "Warpdrive",
              origin: new URL(config.BASE_URL).origin,
              authenticatorSelection: { userVerification: "required" },
              registration: {
                afterVerification: ({ verification }) => {
                  if (verification.registrationInfo?.userVerified !== true)
                    rejectAuth("PASSKEY_VERIFICATION_REQUIRED");
                  return Promise.resolve();
                },
              },
              authentication: {
                afterVerification: ({ verification }) => {
                  if (!verification.authenticationInfo.userVerified)
                    rejectAuth("PASSKEY_VERIFICATION_REQUIRED");
                  return Promise.resolve();
                },
              },
            }),
          ]
        : []),
      genericOAuth({
        config: config.AUTH_OIDC_PROVIDERS.map((provider) => ({
          providerId: oidcProviderId(provider.issuer),
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
          discoveryUrl: `${provider.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
          scopes: ["openid", "profile", "email"],
          pkce: true,
          requireIdTokenVerification: true,
        })),
      }),
      pinnedOidcPlugin(config.AUTH_OIDC_PROVIDERS),
      totpReplayPlugin(db),
      assurancePlugin(db),
      securityChangePlugin(db, config.AUTH_SECRET || config.TOKEN_ENCRYPTION_KEY),
      emailVerificationPlugin(db, config.AUTH_SECRET || config.TOKEN_ENCRYPTION_KEY),
    ],
    logger: { disabled: true },
    onAPIError: { errorURL: `${config.BASE_URL}/login?error=auth_failed` },
  });
}
