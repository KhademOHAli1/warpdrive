import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authUsers, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { startOidcProvider } from "./oidc.protocol.test-helpers";
import { AuthCookieJar, nativeRequest } from "./passkey.protocol.test-helpers";
import { oidcProviderId } from "./providers";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
const PASSWORD = "A-strong-OIDC-linking-qualification-password";
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function setup(differentProviderEmail = false) {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const provider = await startOidcProvider({
    email: differentProviderEmail ? `other-${email}` : email,
    sub: `oidc-${userId}`,
  });
  await h.db.insert(users).values({ id: userId, email, name: "OIDC linking" });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "OIDC linking", emailVerified: true });
  const auth = createBetterAuth(h.db, {
    ...env,
    AUTH_SECRET: "OIDC-linking-test-secret-over-thirty-two-characters",
    AUTH_GOOGLE_ENABLED: false,
    AUTH_ALLOW_PASSWORD: true,
    AUTH_OIDC_PROVIDERS: [
      {
        name: "Qualification OIDC",
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
      },
    ],
  });
  const context = await auth.$context;
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await context.password.hash(PASSWORD),
  });
  return {
    userId,
    email,
    provider,
    auth,
    jar: new AuthCookieJar(new URL(env.BASE_URL).origin),
    providerId: oidcProviderId(provider.issuer),
  };
}

async function begin(fixture: Awaited<ReturnType<typeof setup>>, path: string) {
  return nativeRequest(fixture.auth, fixture.jar, path, {
    provider: fixture.providerId,
    callbackURL: `${fixture.jar.origin}/`,
    disableRedirect: true,
  });
}

async function finish(fixture: Awaited<ReturnType<typeof setup>>, response: Response) {
  const authorization = new URL(((await response.json()) as { url: string }).url);
  const callback = await fixture.provider.authorize(authorization);
  const result = await fixture.auth.handler(
    new Request(callback, { headers: fixture.jar.headers() }),
  );
  fixture.jar.apply(result);
  return result;
}

describe("explicit OIDC account linking through native HTTP handlers", () => {
  test("prevents email-only implicit linking, allows explicit fresh linking, and blocks stale linking", async () => {
    const fixture = await setup();
    try {
      expect(
        (await finish(fixture, await begin(fixture, "/sign-in/social"))).headers.get("location"),
      ).toContain("error");
      expect(
        await h.db.select().from(authAccounts).where(eq(authAccounts.userId, fixture.userId)),
      ).toHaveLength(1);
      expect(
        (
          await nativeRequest(fixture.auth, fixture.jar, "/sign-in/email", {
            email: fixture.email,
            password: PASSWORD,
          })
        ).status,
      ).toBe(200);
      const link = await begin(fixture, "/link-social");
      expect(link.status).toBe(200);
      expect((await finish(fixture, link)).headers.get("location")).not.toContain("error");
      expect(
        await h.db.select().from(authAccounts).where(eq(authAccounts.userId, fixture.userId)),
      ).toHaveLength(2);
      const current = await resolveWorkflowSession(
        h.db,
        fixture.jar.headers(),
        AbortSignal.timeout(5000),
      );
      expect(current?.user.id).toBe(fixture.userId);
      await h.db
        .update(sessions)
        .set({ freshAuthenticatedAt: new Date(Date.now() - 20 * 60_000) })
        .where(eq(sessions.userId, fixture.userId));
      expect((await begin(fixture, "/link-social")).status).not.toBe(200);
    } finally {
      await fixture.provider.close();
    }
  });

  test("refuses explicit linking when the provider returns a different verified email", async () => {
    const fixture = await setup(true);
    try {
      expect(
        (
          await nativeRequest(fixture.auth, fixture.jar, "/sign-in/email", {
            email: fixture.email,
            password: PASSWORD,
          })
        ).status,
      ).toBe(200);
      const link = await begin(fixture, "/link-social");
      expect(link.status).toBe(200);
      expect((await finish(fixture, link)).headers.get("location")).toContain("error");
      expect(
        await h.db.select().from(authAccounts).where(eq(authAccounts.userId, fixture.userId)),
      ).toHaveLength(1);
    } finally {
      await fixture.provider.close();
    }
  });
});
