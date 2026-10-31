import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authPasskeys, authUsers, users } from "@/db/schema";
import type { TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import {
  AuthCookieJar,
  authenticationResponse,
  nativeRequest,
  type RegistrationOptions,
  registrationResponse,
  syntheticAuthenticator,
} from "./passkey.protocol.test-helpers";

export const LAST_METHOD_PASSWORD = "Strong-last-method-qualification-password";

export async function lastMethodFixture(h: TestDb, withPasskey: boolean) {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const config = {
    ...env,
    AUTH_ALLOW_PASSWORD: true,
    AUTH_ALLOW_PASSKEY: true,
    AUTH_GOOGLE_ENABLED: false,
    AUTH_MICROSOFT_CLIENT_ID: "",
    AUTH_MICROSOFT_CLIENT_SECRET: "",
    AUTH_OIDC_PROVIDERS: [],
  };
  const auth = createBetterAuth(h.db, config);
  await h.db.insert(users).values({ id: userId, email, name: "Last usable method" });
  await h.db.insert(authUsers).values({
    id: userId,
    email,
    name: "Last usable method",
    emailVerified: true,
  });
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await (await auth.$context).password.hash(LAST_METHOD_PASSWORD),
  });
  const jar = new AuthCookieJar(new URL(config.BASE_URL).origin);
  expect(
    (
      await nativeRequest(auth, jar, "/sign-in/email", {
        email,
        password: LAST_METHOD_PASSWORD,
      })
    ).status,
  ).toBe(200);
  if (withPasskey) {
    const key = syntheticAuthenticator();
    const options = await nativeRequest(auth, jar, "/passkey/generate-register-options");
    expect(options.status).toBe(200);
    expect(
      (
        await nativeRequest(auth, jar, "/passkey/verify-registration", {
          response: registrationResponse(
            key,
            (await options.json()) as RegistrationOptions,
            jar.origin,
          ),
        })
      ).status,
    ).toBe(200);
    const challenge = await nativeRequest(auth, jar, "/passkey/generate-authenticate-options");
    expect(challenge.status).toBe(200);
    expect(
      (
        await nativeRequest(auth, jar, "/passkey/verify-authentication", {
          response: authenticationResponse(
            key,
            (await challenge.json()) as { challenge: string; rpId: string },
            jar.origin,
          ),
        })
      ).status,
    ).toBe(200);
  }
  const [passkey] = await h.db
    .select({ id: authPasskeys.id })
    .from(authPasskeys)
    .where(eq(authPasskeys.userId, userId));
  return { userId, email, jar, config, passkey };
}
