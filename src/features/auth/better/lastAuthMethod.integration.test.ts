import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authAccounts, authPasskeys } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { LAST_METHOD_PASSWORD, lastMethodFixture } from "./lastAuthMethod.test-helpers";
import { nativeAuthGateway } from "./nativeGateway";
import { AuthCookieJar, nativeRequest } from "./passkey.protocol.test-helpers";
import { runSecurityAction } from "./securityActions";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("cannot delete the only usable passkey when stored password/provider logins are disabled", async () => {
  const f = await lastMethodFixture(h, true);
  const config = { ...f.config, AUTH_ALLOW_PASSWORD: false };
  await h.db.insert(authAccounts).values({
    userId: f.userId,
    providerId: "google",
    accountId: `disabled-google-${f.userId}`,
  });
  const auth = createBetterAuth(h.db, config);
  expect(
    (
      await nativeRequest(auth, new AuthCookieJar(f.jar.origin), "/sign-in/email", {
        email: f.email,
        password: LAST_METHOD_PASSWORD,
      })
    ).status,
  ).not.toBe(200);
  const response = await nativeAuthGateway(
    h.db,
    new Request(`${f.jar.origin}/api/auth/passkey/delete-passkey`, {
      method: "POST",
      headers: f.jar.headers(),
      body: JSON.stringify({ id: f.passkey?.id }),
    }),
    config,
  );
  expect(await response.json()).toMatchObject({ code: "LAST_AUTH_METHOD" });
  expect(response.status).not.toBe(200);
  expect(
    await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, f.userId)),
  ).toHaveLength(1);
});

test.each([
  { passwordEnabled: false, passwordPresent: true },
  { passwordEnabled: true, passwordPresent: false },
  { passwordEnabled: true, passwordPresent: true },
])(
  "unlink checks password enabled=$passwordEnabled and hash present=$passwordPresent",
  async ({ passwordEnabled, passwordPresent }) => {
    const f = await lastMethodFixture(h, false);
    if (!passwordPresent)
      await h.db
        .update(authAccounts)
        .set({ password: null })
        .where(eq(authAccounts.userId, f.userId));
    const accountId = `enabled-google-${f.userId}`;
    await h.db.insert(authAccounts).values({
      userId: f.userId,
      providerId: "google",
      accountId,
    });
    const auth = createBetterAuth(h.db, {
      ...f.config,
      AUTH_ALLOW_PASSWORD: passwordEnabled,
      AUTH_GOOGLE_ENABLED: true,
      GOOGLE_OAUTH_CLIENT_ID: "qualification-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "qualification-secret",
    });
    expect((await auth.$context).socialProviders.some((provider) => provider.id === "google")).toBe(
      true,
    );
    const result = await runSecurityAction(
      h.db,
      auth,
      f.jar.headers(),
      { action: "unlinkAccount", providerId: "google", accountId },
      AbortSignal.timeout(10_000),
    );
    const removable = passwordEnabled && passwordPresent;
    expect(result).toEqual(
      removable ? { ok: true, data: {} } : { ok: false, error: "LAST_AUTH_METHOD" },
    );
    expect(
      await h.db.select().from(authAccounts).where(eq(authAccounts.userId, f.userId)),
    ).toHaveLength(removable ? 1 : 2);
    if (removable)
      expect(
        (
          await nativeRequest(auth, new AuthCookieJar(f.jar.origin), "/sign-in/email", {
            email: f.email,
            password: LAST_METHOD_PASSWORD,
          })
        ).status,
      ).toBe(200);
  },
);

test("an enabled password remains a usable fallback after deleting the final passkey", async () => {
  const f = await lastMethodFixture(h, true);
  const response = await nativeAuthGateway(
    h.db,
    new Request(`${f.jar.origin}/api/auth/passkey/delete-passkey`, {
      method: "POST",
      headers: f.jar.headers(),
      body: JSON.stringify({ id: f.passkey?.id }),
    }),
    f.config,
  );
  expect(response.status).toBe(200);
  expect(
    await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, f.userId)),
  ).toHaveLength(0);
  expect(
    (
      await nativeRequest(
        createBetterAuth(h.db, f.config),
        new AuthCookieJar(f.jar.origin),
        "/sign-in/email",
        {
          email: f.email,
          password: LAST_METHOD_PASSWORD,
        },
      )
    ).status,
  ).toBe(200);
});

test("an empty credential row is not a password fallback for the only passkey", async () => {
  const f = await lastMethodFixture(h, true);
  await h.db.update(authAccounts).set({ password: null }).where(eq(authAccounts.userId, f.userId));
  const response = await nativeAuthGateway(
    h.db,
    new Request(`${f.jar.origin}/api/auth/passkey/delete-passkey`, {
      method: "POST",
      headers: f.jar.headers(),
      body: JSON.stringify({ id: f.passkey?.id }),
    }),
    f.config,
  );
  expect(await response.json()).toMatchObject({ code: "LAST_AUTH_METHOD" });
  expect(
    await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, f.userId)),
  ).toHaveLength(1);
});

test("disabled passkeys do not allow unlinking the only enabled provider", async () => {
  const f = await lastMethodFixture(h, true);
  const accountId = `enabled-google-${f.userId}`;
  await h.db.insert(authAccounts).values({ userId: f.userId, providerId: "google", accountId });
  const auth = createBetterAuth(h.db, {
    ...f.config,
    AUTH_ALLOW_PASSWORD: false,
    AUTH_ALLOW_PASSKEY: false,
    AUTH_GOOGLE_ENABLED: true,
    GOOGLE_OAUTH_CLIENT_ID: "qualification-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "qualification-secret",
  });
  expect(
    await runSecurityAction(
      h.db,
      auth,
      f.jar.headers(),
      { action: "unlinkAccount", providerId: "google", accountId },
      AbortSignal.timeout(10_000),
    ),
  ).toEqual({ ok: false, error: "LAST_AUTH_METHOD" });
  expect(
    await h.db.select().from(authAccounts).where(eq(authAccounts.userId, f.userId)),
  ).toHaveLength(2);
});
