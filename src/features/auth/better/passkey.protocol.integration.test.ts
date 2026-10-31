import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authPasskeys, authUsers, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import {
  AuthCookieJar,
  authenticationResponse,
  nativeRequest,
  type RegistrationOptions,
  registrationResponse,
  syntheticAuthenticator,
} from "./passkey.protocol.test-helpers";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
const PASSWORD = "A-strong-protocol-qualification-password";
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function pendingAdministrator() {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  await h.db
    .insert(users)
    .values({ id: userId, email, name: "Passkey qualification", isAdmin: true });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "Passkey qualification", emailVerified: true });
  const auth = createBetterAuth(h.db, {
    ...env,
    AUTH_SECRET: "protocol-qualification-secret-over-thirty-two-characters",
    AUTH_GOOGLE_ENABLED: false,
    AUTH_ALLOW_PASSWORD: true,
    AUTH_ALLOW_PASSKEY: true,
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
  expect(await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000))).toBeNull();
  return { auth, jar, userId };
}

async function registrationOptions(auth: ReturnType<typeof createBetterAuth>, jar: AuthCookieJar) {
  const response = await nativeRequest(auth, jar, "/passkey/generate-register-options");
  expect(response.status).toBe(200);
  return (await response.json()) as RegistrationOptions;
}

async function authenticationOptions(
  auth: ReturnType<typeof createBetterAuth>,
  jar: AuthCookieJar,
) {
  const response = await nativeRequest(auth, jar, "/passkey/generate-authenticate-options");
  expect(response.status).toBe(200);
  return (await response.json()) as { challenge: string; rpId: string };
}

describe("real WebAuthn protocol against Better Auth and PostgreSQL", () => {
  test("a pending weak session cannot enroll another passkey after a strong factor exists", async () => {
    const { auth, jar } = await pendingAdministrator();
    const authenticator = syntheticAuthenticator();
    const registration = registrationResponse(
      authenticator,
      await registrationOptions(auth, jar),
      jar.origin,
    );
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-registration", { response: registration }))
        .status,
    ).toBe(200);
    expect(await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000))).toBeNull();
    expect((await nativeRequest(auth, jar, "/passkey/generate-register-options")).status).not.toBe(
      200,
    );
  });

  test("registers and signs in with P-256 user verification, unlocking a pending administrator", async () => {
    const { auth, jar, userId } = await pendingAdministrator();
    const authenticator = syntheticAuthenticator();
    const options = await registrationOptions(auth, jar);
    const registration = registrationResponse(authenticator, options, jar.origin);
    expect(
      (
        await nativeRequest(auth, jar, "/passkey/verify-registration", {
          response: registration,
          name: "Protocol passkey",
        })
      ).status,
    ).toBe(200);
    expect(
      (await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, userId))).length,
    ).toBe(1);
    // Enrollment alone cannot promote the existing password session into a strong session.
    expect(await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000))).toBeNull();
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-registration", { response: registration }))
        .status,
    ).not.toBe(200);

    const challenge = await authenticationOptions(auth, jar);
    const assertion = authenticationResponse(authenticator, challenge, jar.origin);
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-authentication", { response: assertion }))
        .status,
    ).toBe(200);
    const workflow = await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000));
    expect(workflow?.user.id).toBe(userId);
    expect(workflow?.session.assurance).toBe("passkey");
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-authentication", { response: assertion }))
        .status,
    ).not.toBe(200);
  });

  test("refuses enrollment without user verification and from a different origin", async () => {
    const { auth, jar, userId } = await pendingAdministrator();
    const authenticator = syntheticAuthenticator();
    const noUv = registrationResponse(
      authenticator,
      await registrationOptions(auth, jar),
      jar.origin,
      false,
    );
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-registration", { response: noUv })).status,
    ).not.toBe(200);
    const foreign = registrationResponse(
      authenticator,
      await registrationOptions(auth, jar),
      "https://attacker.example.com",
    );
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-registration", { response: foreign }))
        .status,
    ).not.toBe(200);
    expect(
      await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, userId)),
    ).toHaveLength(0);
  });

  test("refuses authentication without user verification and with a wrong origin", async () => {
    const { auth, jar, userId } = await pendingAdministrator();
    const authenticator = syntheticAuthenticator();
    const registration = registrationResponse(
      authenticator,
      await registrationOptions(auth, jar),
      jar.origin,
    );
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-registration", { response: registration }))
        .status,
    ).toBe(200);
    const noUv = authenticationResponse(
      authenticator,
      await authenticationOptions(auth, jar),
      jar.origin,
      false,
    );
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-authentication", { response: noUv })).status,
    ).not.toBe(200);
    const foreign = authenticationResponse(
      authenticator,
      await authenticationOptions(auth, jar),
      "https://attacker.example.com",
    );
    expect(
      (await nativeRequest(auth, jar, "/passkey/verify-authentication", { response: foreign }))
        .status,
    ).not.toBe(200);
    expect(await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000))).toBeNull();
    const stored = await h.db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(stored.every((session) => session.assurance !== "passkey")).toBe(true);
  });
});
