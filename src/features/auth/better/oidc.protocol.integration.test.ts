import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authInvitations, authUsers, users } from "@/db/schema";
import { hashInvitationToken } from "@/features/auth/management/invitations";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { startOidcProvider } from "./oidc.protocol.test-helpers";
import { AuthCookieJar, nativeRequest } from "./passkey.protocol.test-helpers";
import { oidcProviderId } from "./providers";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function setup(invited = true, options: Parameters<typeof startOidcProvider>[1] = {}) {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const provider = await startOidcProvider({ email, sub: `oidc-${userId}` }, options);
  const auth = createBetterAuth(h.db, {
    ...env,
    AUTH_SECRET: "OIDC-protocol-test-secret-over-thirty-two-characters",
    AUTH_GOOGLE_ENABLED: false,
    AUTH_OIDC_PROVIDERS: [
      {
        name: "Qualification OIDC",
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
      },
    ],
  });
  const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
  if (invited) {
    await h.db
      .insert(users)
      .values({ id: userId, email, name: "OIDC qualification", invitedAt: new Date() });
    const token = randomBytes(32).toString("base64url");
    await h.db.insert(authInvitations).values({
      userId,
      email,
      invitedBy: userId,
      tokenHash: hashInvitationToken(token),
      expiresAt: new Date(Date.now() + 60_000),
    });
    jar.apply(
      new Response(null, { headers: { "set-cookie": `wd_invite=${token}; Path=/; HttpOnly` } }),
    );
  }
  return { userId, email, provider, auth, jar, providerId: oidcProviderId(provider.issuer) };
}

async function begin(fixture: Awaited<ReturnType<typeof setup>>) {
  const response = await nativeRequest(fixture.auth, fixture.jar, "/sign-in/social", {
    provider: fixture.providerId,
    callbackURL: `${fixture.jar.origin}/`,
    disableRedirect: true,
  });
  expect(response.status).toBe(200);
  return new URL(((await response.json()) as { url: string }).url);
}

async function finish(fixture: Awaited<ReturnType<typeof setup>>, callback: URL) {
  const response = await fixture.auth.handler(
    new Request(callback, { headers: fixture.jar.headers() }),
  );
  fixture.jar.apply(response);
  return response;
}

describe("OIDC discovery, PKCE and verified identities over real HTTP", () => {
  test("rejects a discovered issuer different from the configured issuer, including startup retry", async () => {
    for (const initialDiscoveryFailures of [0, 1]) {
      const fixture = await setup(true, { mismatchedIssuer: true, initialDiscoveryFailures });
      try {
        const response = await nativeRequest(fixture.auth, fixture.jar, "/sign-in/social", {
          provider: fixture.providerId,
          callbackURL: `${fixture.jar.origin}/`,
          disableRedirect: true,
        });
        expect(response.status).not.toBe(200);
        expect(await response.json()).toMatchObject({ code: "OIDC_ISSUER_MISMATCH" });
        const direct = await nativeRequest(fixture.auth, fixture.jar, "/sign-in/social", {
          provider: fixture.providerId,
          idToken: { token: "untrusted-direct-token" },
        });
        expect(await direct.json()).toMatchObject({ code: "OIDC_ISSUER_MISMATCH" });
        const callback = await nativeRequest(
          fixture.auth,
          fixture.jar,
          `/callback/${fixture.providerId}?code=untrusted&state=untrusted`,
        );
        expect(await callback.json()).toMatchObject({ code: "OIDC_ISSUER_MISMATCH" });
        expect(
          await resolveWorkflowSession(h.db, fixture.jar.headers(), AbortSignal.timeout(5000)),
        ).toBeNull();
        const [invitation] = await h.db
          .select()
          .from(authInvitations)
          .where(eq(authInvitations.userId, fixture.userId));
        expect(invitation?.acceptedAt).toBeNull();
        expect(fixture.provider.exchanges()).toBe(0);
      } finally {
        await fixture.provider.close();
      }
    }
  });
  test("accepts an invited verified identity, preserves its CRM UUID and rejects replay", async () => {
    const fixture = await setup();
    try {
      const authorization = await begin(fixture);
      expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorization.searchParams.get("nonce")).toBeTruthy();
      const callback = await fixture.provider.authorize(authorization);
      const priorHeaders = fixture.jar.headers();
      expect((await finish(fixture, callback)).status).toBe(302);
      const workflow = await resolveWorkflowSession(
        h.db,
        fixture.jar.headers(),
        AbortSignal.timeout(5000),
      );
      expect(workflow?.user.id).toBe(fixture.userId);
      expect(workflow?.authUser.emailVerified).toBe(true);
      expect(fixture.provider.exchanges()).toBe(1);
      const [account] = await h.db
        .select()
        .from(authAccounts)
        .where(eq(authAccounts.userId, fixture.userId));
      expect(account?.providerId).toBe(fixture.providerId);
      expect(account?.accountId).toBe(`oidc-${fixture.userId}`);
      const [invitation] = await h.db
        .select()
        .from(authInvitations)
        .where(eq(authInvitations.userId, fixture.userId));
      expect(invitation?.acceptedAt).not.toBeNull();
      const replay = await fixture.auth.handler(new Request(callback, { headers: priorHeaders }));
      expect(replay.headers.get("location")).toContain("error");
      expect(fixture.provider.exchanges()).toBe(1);
    } finally {
      await fixture.provider.close();
    }
  });

  test("denies an uninvited external identity without creating a local auth user", async () => {
    const fixture = await setup(false);
    try {
      const callback = await fixture.provider.authorize(await begin(fixture));
      expect((await finish(fixture, callback)).headers.get("location")).toContain("error");
      expect(
        await resolveWorkflowSession(h.db, fixture.jar.headers(), AbortSignal.timeout(5000)),
      ).toBeNull();
      expect(
        await h.db.select().from(authUsers).where(eq(authUsers.email, fixture.email)),
      ).toHaveLength(0);
    } finally {
      await fixture.provider.close();
    }
  });

  test("rejects wrong state, nonce, issuer, audience and signature before invitation consumption", async () => {
    const fixture = await setup();
    try {
      for (const fault of [
        "state",
        "nonce",
        "issuer",
        "audience",
        "signature",
        "email",
        "pkce",
      ] as const) {
        const callback = await fixture.provider.authorize(await begin(fixture), fault);
        expect((await finish(fixture, callback)).headers.get("location"), fault).toContain("error");
        expect(
          await resolveWorkflowSession(h.db, fixture.jar.headers(), AbortSignal.timeout(5000)),
          fault,
        ).toBeNull();
        const [invitation] = await h.db
          .select()
          .from(authInvitations)
          .where(eq(authInvitations.userId, fixture.userId));
        expect(invitation?.acceptedAt, fault).toBeNull();
      }
      expect(
        await h.db.select().from(authUsers).where(eq(authUsers.id, fixture.userId)),
      ).toHaveLength(0);
    } finally {
      await fixture.provider.close();
    }
  });
});
