import { randomBytes, randomUUID } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import {
  authAccounts,
  authInvitations,
  authMailOutbox,
  authPasskeys,
  authSecurityEvents,
  authUsers,
  oauthAccessTokens,
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
  users,
} from "@/db/schema";
import { hashInvitationToken } from "@/features/auth/management/invitations";
import { decryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { startOidcProvider } from "./oidc.protocol.test-helpers";
import {
  AuthCookieJar,
  authenticationResponse,
  nativeRequest,
  type RegistrationOptions,
  registrationResponse,
  syntheticAuthenticator,
} from "./passkey.protocol.test-helpers";
import { oidcProviderId } from "./providers";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
const PASSWORD = "A-security-notification-test-password";
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
async function setup(
  provider?: Awaited<ReturnType<typeof startOidcProvider>>,
  email = `${randomUUID()}@example.com`,
) {
  const userId = randomUUID();
  await h.db.insert(users).values({ id: userId, email, name: "Notification test" });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "Notification test", emailVerified: true });
  const auth = createBetterAuth(h.db, {
    ...env,
    AUTH_SECRET: "notification-qualification-secret-over-thirty-two-characters",
    AUTH_GOOGLE_ENABLED: false,
    AUTH_ALLOW_PASSWORD: true,
    AUTH_ALLOW_PASSKEY: true,
    AUTH_OIDC_PROVIDERS: provider
      ? [
          {
            name: "Test identity",
            issuer: provider.issuer,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
          },
        ]
      : [],
  });
  const context = await auth.$context;
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await context.password.hash(PASSWORD),
  });
  const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
  expect(
    (await nativeRequest(auth, jar, "/sign-in/email", { email, password: PASSWORD })).status,
  ).toBe(200);
  return { auth, jar, userId, email };
}
async function notices(userId: string) {
  return h.db
    .select()
    .from(authMailOutbox)
    .where(and(eq(authMailOutbox.userId, userId), eq(authMailOutbox.kind, "security_change")));
}
async function events(userId: string) {
  return (
    await h.db.select().from(authSecurityEvents).where(eq(authSecurityEvents.targetUserId, userId))
  ).filter((row) => row.action.startsWith("security."));
}
function mailUrl(row: typeof authMailOutbox.$inferSelect): string {
  const payload = decryptToken(row.payloadEnc);
  expect(payload.ok).toBe(true);
  if (!payload.ok) throw new Error("Encrypted test message could not be read");
  return (JSON.parse(payload.value) as { url: string }).url;
}
async function visit(
  auth: ReturnType<typeof createBetterAuth>,
  jar: AuthCookieJar,
  url: string | URL,
) {
  const nativeUrl = new URL(url);
  if (nativeUrl.pathname === "/auth/verify-email") nativeUrl.pathname = "/api/auth/verify-email";
  const response = await auth.handler(new Request(nativeUrl, { headers: jar.headers() }));
  jar.apply(response);
  return response;
}

async function seedGrants(userId: string) {
  const clientId = randomUUID();
  const expiresAt = new Date(Date.now() + 60_000);
  await h.db.insert(oauthClients).values({
    id: clientId,
    name: "Security change test",
    redirectUris: ["https://client.example.com/callback"],
  });
  await h.db.insert(oauthAccessTokens).values({ jti: randomUUID(), userId, clientId, expiresAt });
  await h.db
    .insert(oauthRefreshTokens)
    .values({ tokenHash: randomUUID(), userId, clientId, expiresAt });
  await h.db.insert(oauthAuthCodes).values({
    codeHash: randomUUID(),
    userId,
    clientId,
    redirectUri: "https://client.example.com/callback",
    codeChallenge: "test-challenge",
    expiresAt,
  });
}
async function expectRevokedGrants(userId: string) {
  const access = await h.db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.userId, userId));
  const refresh = await h.db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, userId));
  const codes = await h.db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.userId, userId));
  expect(access.length).toBeGreaterThan(0);
  expect(refresh.length).toBeGreaterThan(0);
  expect(codes.length).toBeGreaterThan(0);
  expect(access.every((row) => row.revokedAt !== null)).toBe(true);
  expect(refresh.every((row) => row.revokedAt !== null)).toBe(true);
  expect(codes.every((row) => row.consumedAt !== null)).toBe(true);
}

describe("native security changes notify and audit the affected identity", () => {
  test("only successful password changes and resets emit a single secret-free notification", async () => {
    const f = await setup();
    f.jar.apply(new Response(null, { headers: { "set-cookie": "warpdrive_locale=fa; Path=/" } }));
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/change-password", {
          currentPassword: "incorrect",
          newPassword: "A-new-unique-qualification-password",
        })
      ).status,
    ).not.toBe(200);
    expect(await notices(f.userId)).toHaveLength(0);
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/change-password", {
          currentPassword: PASSWORD,
          newPassword: "A-new-unique-qualification-password",
        })
      ).status,
    ).toBe(200);
    expect(await notices(f.userId)).toHaveLength(1);
    await nativeRequest(f.auth, f.jar, "/request-password-reset", {
      email: f.email,
      redirectTo: "/auth/reset-password",
    });
    const [reset] = await h.db
      .select()
      .from(authMailOutbox)
      .where(and(eq(authMailOutbox.userId, f.userId), eq(authMailOutbox.kind, "password_reset")));
    expect(reset).toBeDefined();
    if (!reset) throw new Error("Reset delivery missing");
    const token = new URL(mailUrl(reset)).pathname.split("/").at(-1);
    await seedGrants(f.userId);
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/reset-password", {
          token,
          newPassword: "A-reset-unique-qualification-password",
        })
      ).status,
    ).toBe(200);
    expect(await notices(f.userId)).toHaveLength(2);
    expect((await notices(f.userId)).every((row) => row.locale === "fa")).toBe(true);
    await expectRevokedGrants(f.userId);
    expect((await events(f.userId)).map((row) => row.action).sort()).toEqual([
      "security.password.changed",
      "security.password.reset",
    ]);
    for (const row of await notices(f.userId)) {
      const payload = decryptToken(row.payloadEnc);
      expect(payload.ok && payload.value).not.toContain(PASSWORD);
      expect(payload.ok && payload.value).not.toContain(token);
    }
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/reset-password", {
          token,
          newPassword: "A-replayed-unique-qualification-password",
        })
      ).status,
    ).not.toBe(200);
    expect(await notices(f.userId)).toHaveLength(2);
  });

  test("a verified email change notifies both addresses once and never logs verification secrets", async () => {
    const f = await setup();
    const newEmail = `${randomUUID()}@example.com`;
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/change-email", {
          newEmail,
          callbackURL: "/auth/continue",
        })
      ).status,
    ).toBe(200);
    expect(await notices(f.userId)).toHaveLength(0);
    const [confirmation] = await h.db
      .select()
      .from(authMailOutbox)
      .where(and(eq(authMailOutbox.userId, f.userId), eq(authMailOutbox.recipient, f.email)));
    if (!confirmation) throw new Error("Old-address confirmation missing");
    await visit(f.auth, f.jar, mailUrl(confirmation));
    expect(await notices(f.userId)).toHaveLength(0);
    const [verification] = await h.db
      .select()
      .from(authMailOutbox)
      .where(and(eq(authMailOutbox.userId, f.userId), eq(authMailOutbox.recipient, newEmail)));
    if (!verification) throw new Error("New-address verification missing");
    const verifiedUrl = mailUrl(verification);
    await visit(f.auth, f.jar, verifiedUrl);
    expect((await notices(f.userId)).map((row) => row.recipient).sort()).toEqual(
      [f.email, newEmail].sort(),
    );
    expect((await events(f.userId)).map((row) => row.action)).toEqual(["security.email.changed"]);
    await visit(f.auth, f.jar, verifiedUrl);
    expect(await notices(f.userId)).toHaveLength(2);
    expect(JSON.stringify(await events(f.userId))).not.toContain(
      new URL(verifiedUrl).searchParams.get("token"),
    );
  });

  test("notifies only confirmed TOTP enrollment, recovery rotation and factor removal", async () => {
    const f = await setup();
    const enabled = await nativeRequest(f.auth, f.jar, "/two-factor/enable", {
      password: PASSWORD,
    });
    expect(enabled.status).toBe(200);
    const setupData = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
    expect(await notices(f.userId)).toHaveLength(0);
    const secret = new URL(setupData.totpURI).searchParams.get("secret") ?? "";
    const otp = createOTP(base32.decode(secret));
    await seedGrants(f.userId);
    const validCode = await otp.totp();
    const wrongCode = `${(Number(validCode[0]) + 1) % 10}${validCode.slice(1)}`;
    expect(
      (await nativeRequest(f.auth, f.jar, "/two-factor/verify-totp", { code: wrongCode })).status,
    ).not.toBe(200);
    expect(await notices(f.userId)).toHaveLength(0);
    expect(
      (await nativeRequest(f.auth, f.jar, "/two-factor/verify-totp", { code: await otp.totp() }))
        .status,
    ).toBe(200);
    await expectRevokedGrants(f.userId);
    expect(
      await resolveWorkflowSession(h.db, f.jar.headers(), AbortSignal.timeout(5000)),
    ).not.toBeNull();
    await seedGrants(f.userId);
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/two-factor/generate-backup-codes", {
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    expect(
      (await nativeRequest(f.auth, f.jar, "/two-factor/disable", { password: PASSWORD })).status,
    ).toBe(200);
    expect(await notices(f.userId)).toHaveLength(3);
    await expectRevokedGrants(f.userId);
    expect((await events(f.userId)).map((row) => row.action).sort()).toEqual([
      "security.factor.disabled",
      "security.factor.enabled",
      "security.recovery.rotated",
    ]);
    expect(JSON.stringify(await events(f.userId))).not.toContain(secret);
    for (const row of await notices(f.userId)) {
      const value = decryptToken(row.payloadEnc);
      expect(value.ok && value.value).not.toContain(secret);
      expect(value.ok && value.value).not.toContain(setupData.backupCodes[0]);
    }
  });

  test("audits real passkey registration, rename and removal without exposing credential data", async () => {
    const f = await setup();
    const device = syntheticAuthenticator();
    const options = (await (
      await nativeRequest(f.auth, f.jar, "/passkey/generate-register-options")
    ).json()) as RegistrationOptions;
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/passkey/verify-registration", {
          response: registrationResponse(device, options, f.jar.origin),
          name: "Private device name",
        })
      ).status,
    ).toBe(200);
    const authentication = (await (
      await nativeRequest(f.auth, f.jar, "/passkey/generate-authenticate-options")
    ).json()) as { challenge: string; rpId: string };
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/passkey/verify-authentication", {
          response: authenticationResponse(device, authentication, f.jar.origin),
        })
      ).status,
    ).toBe(200);
    const [key] = await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, f.userId));
    if (!key) throw new Error("Registered key missing");
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/passkey/update-passkey", {
          id: key.id,
          name: "Renamed private device",
        })
      ).status,
    ).toBe(200);
    expect(
      (await nativeRequest(f.auth, f.jar, "/passkey/delete-passkey", { id: key.id })).status,
    ).toBe(200);
    expect(await notices(f.userId)).toHaveLength(3);
    expect((await events(f.userId)).map((row) => row.action).sort()).toEqual([
      "security.passkey.added",
      "security.passkey.removed",
      "security.passkey.renamed",
    ]);
    expect(JSON.stringify(await events(f.userId))).not.toContain(device.id);
  });

  test("explicit provider linking emits one notification only after the verified callback", async () => {
    const email = `${randomUUID()}@example.com`;
    const provider = await startOidcProvider({ email, sub: randomUUID() });
    try {
      const f = await setup(provider, email);
      const denied = await nativeRequest(f.auth, f.jar, "/link-social", {
        provider: oidcProviderId(provider.issuer),
        callbackURL: `${f.jar.origin}/settings/security`,
        disableRedirect: true,
      });
      const deniedAuthorization = new URL(((await denied.json()) as { url: string }).url);
      deniedAuthorization.searchParams.set("qualification_fault", "email");
      await visit(f.auth, f.jar, await provider.authorize(deniedAuthorization));
      expect(await notices(f.userId)).toHaveLength(0);
      const started = await nativeRequest(f.auth, f.jar, "/link-social", {
        provider: oidcProviderId(provider.issuer),
        callbackURL: `${f.jar.origin}/settings/security`,
        disableRedirect: true,
      });
      expect(started.status).toBe(200);
      expect(await notices(f.userId)).toHaveLength(0);
      const authorization = new URL(((await started.json()) as { url: string }).url);
      await visit(f.auth, f.jar, await provider.authorize(authorization));
      expect(await notices(f.userId)).toHaveLength(1);
      expect((await events(f.userId)).map((row) => row.action)).toEqual([
        "security.provider.linked",
      ]);
    } finally {
      await provider.close();
    }
  });
  test("does not label first invited provider enrollment as an account-link security change", async () => {
    const userId = randomUUID();
    const email = `${userId}@example.com`;
    const provider = await startOidcProvider({ email, sub: randomUUID() });
    try {
      await h.db
        .insert(users)
        .values({ id: userId, email, name: "Invited identity", invitedAt: new Date() });
      const token = randomBytes(32).toString("base64url");
      await h.db.insert(authInvitations).values({
        userId,
        email,
        invitedBy: userId,
        tokenHash: hashInvitationToken(token),
        expiresAt: new Date(Date.now() + 60_000),
      });
      const auth = createBetterAuth(h.db, {
        ...env,
        AUTH_SECRET: "notification-enrollment-secret-over-thirty-two-characters",
        AUTH_GOOGLE_ENABLED: false,
        AUTH_OIDC_PROVIDERS: [
          {
            name: "Test identity",
            issuer: provider.issuer,
            clientId: provider.clientId,
            clientSecret: provider.clientSecret,
          },
        ],
      });
      const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
      jar.apply(
        new Response(null, { headers: { "set-cookie": `wd_invite=${token}; Path=/; HttpOnly` } }),
      );
      const started = await nativeRequest(auth, jar, "/sign-in/social", {
        provider: oidcProviderId(provider.issuer),
        callbackURL: `${jar.origin}/`,
        disableRedirect: true,
      });
      expect(started.status).toBe(200);
      const authorization = new URL(((await started.json()) as { url: string }).url);
      await visit(auth, jar, await provider.authorize(authorization));
      expect(
        await h.db.select().from(authAccounts).where(eq(authAccounts.userId, userId)),
      ).toHaveLength(1);
      expect(await notices(userId)).toHaveLength(0);
    } finally {
      await provider.close();
    }
  });
});
