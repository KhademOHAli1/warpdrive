import { randomUUID } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authUsers, users } from "@/db/schema";
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

export async function authenticationFixture(h: TestDb, method: "passkey" | "totp") {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const password = "Strong-gateway-race-qualification-password";
  await h.db.insert(users).values({ id: userId, email, name: "Gateway race" });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "Gateway race", emailVerified: true });
  const auth = createBetterAuth(h.db);
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await (await auth.$context).password.hash(password),
  });
  const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
  expect((await nativeRequest(auth, jar, "/sign-in/email", { email, password })).status).toBe(200);
  let payload: Record<string, unknown>;
  if (method === "passkey") {
    const key = syntheticAuthenticator();
    const options = await nativeRequest(auth, jar, "/passkey/generate-register-options");
    expect(options.status).toBe(200);
    const response = registrationResponse(
      key,
      (await options.json()) as RegistrationOptions,
      jar.origin,
    );
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-registration", { response })).status,
    ).toBe(200);
    await nativeRequest(auth, jar, "/sign-out", {});
    const challenge = await nativeRequest(auth, jar, "/passkey/generate-authenticate-options");
    expect(challenge.status).toBe(200);
    payload = {
      response: authenticationResponse(
        key,
        (await challenge.json()) as { challenge: string; rpId: string },
        jar.origin,
      ),
    };
  } else {
    const enabled = await nativeRequest(auth, jar, "/two-factor/enable", { password });
    expect(enabled.status).toBe(200);
    const uri = new URL(((await enabled.json()) as { totpURI: string }).totpURI);
    const otp = createOTP(base32.decode(uri.searchParams.get("secret") ?? ""));
    expect(
      (await nativeRequest(auth, jar, "/two-factor/verify-totp", { code: await otp.totp() }))
        .status,
    ).toBe(200);
    await nativeRequest(auth, jar, "/sign-out", {});
    expect(
      await (await nativeRequest(auth, jar, "/sign-in/email", { email, password })).json(),
    ).toMatchObject({ twoFactorRedirect: true });
    // The adjacent counter is accepted by native TOTP and differs from the used enrollment code.
    payload = { code: await otp.hotp(Math.floor(Date.now() / 30_000) + 1) };
  }
  return {
    userId,
    jar,
    request: new Request(
      `${jar.origin}/api/auth/${method === "passkey" ? "passkey/verify-authentication" : "two-factor/verify-totp"}`,
      { method: "POST", headers: jar.headers(), body: JSON.stringify(payload) },
    ),
  };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function waitsForAdvisoryLock(h: TestDb, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (!signal.aborted && Date.now() < deadline) {
    const result = await h.pool.query<{ waiting: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory') AS waiting",
    );
    if (result.rows[0]?.waiting === true) return true;
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  return false;
}
