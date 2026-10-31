import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authUsers, users } from "@/db/schema";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { nativeAuthGateway } from "./nativeGateway";
import { waitForNativeLock } from "./nativeGateway.anonymous.test-helpers";
import { deferred } from "./nativeGateway.race.test-helpers";
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

test("anonymous verified OIDC callback retains the grant lock through native user/profile commit", async () => {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const sub = `oidc-${userId}`;
  const provider = await startOidcProvider({ email, sub });
  try {
    const config = {
      ...env,
      AUTH_GOOGLE_ENABLED: false,
      AUTH_OIDC_PROVIDERS: [
        {
          name: "Gateway callback",
          issuer: provider.issuer,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
        },
      ],
    };
    const providerId = oidcProviderId(provider.issuer);
    await h.db.insert(users).values({ id: userId, email, name: "OIDC callback owner" });
    await h.db
      .insert(authUsers)
      .values({ id: userId, email, name: "OIDC callback owner", emailVerified: false });
    await h.db.insert(authAccounts).values({ userId, providerId, accountId: sub });
    const auth = createBetterAuth(h.db, config);
    const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
    const begin = await nativeRequest(auth, jar, "/sign-in/social", {
      provider: providerId,
      callbackURL: `${jar.origin}/`,
      disableRedirect: true,
    });
    expect(begin.status).toBe(200);
    const callbackUrl = await provider.authorize(
      new URL(((await begin.json()) as { url: string }).url),
    );
    expect(jar.headers().get("cookie")).not.toContain("wd_sid=");
    const held = deferred();
    const release = deferred();
    const polling = new AbortController();
    const blocker = h.db.transaction(async (tx) => {
      await tx.select().from(authUsers).where(eq(authUsers.id, userId)).for("update");
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const callback = nativeAuthGateway(
      h.db,
      new Request(callbackUrl, { headers: jar.headers() }),
      config,
    );
    let observer: Promise<boolean> | undefined;
    try {
      expect(
        await Promise.race([
          callback.then(() => false),
          waitForNativeLock(h, '%update "auth_users"%', polling.signal),
        ]),
      ).toBe(true);
      observer = h.db.transaction(async (tx) => {
        await lockMcpGrants(tx, AbortSignal.timeout(10_000));
        const [identity] = await tx
          .select({ verified: authUsers.emailVerified })
          .from(authUsers)
          .where(eq(authUsers.id, userId));
        return identity?.verified === true;
      });
      expect(
        await Promise.race([
          observer.then(() => false),
          waitForNativeLock(h, "%pg_advisory_xact_lock%", polling.signal),
        ]),
      ).toBe(true);
    } finally {
      release.resolve();
      polling.abort();
      await blocker;
      await callback;
      await observer;
    }
    const response = await callback;
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).not.toContain("error");
    expect(await observer).toBe(true);
    jar.apply(response);
    expect(
      (await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000)))?.user.id,
    ).toBe(userId);
  } finally {
    await provider.close();
  }
});
