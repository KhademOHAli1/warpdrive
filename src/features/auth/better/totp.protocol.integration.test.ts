import { randomUUID } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { env } from "@/config/env";
import { authAccounts, authTwoFactors, authUsers, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { AuthCookieJar, nativeRequest } from "./passkey.protocol.test-helpers";
import { hashRecoveryInput } from "./recoveryCodes";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
const PASSWORD = "A-strong-TOTP-qualification-password";
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

async function setup() {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  await h.db.insert(users).values({ id: userId, email, name: "TOTP qualification", isAdmin: true });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "TOTP qualification", emailVerified: true });
  const auth = createBetterAuth(h.db, {
    ...env,
    AUTH_SECRET: "TOTP-protocol-test-secret-over-thirty-two-characters",
    AUTH_GOOGLE_ENABLED: false,
    AUTH_ALLOW_PASSWORD: true,
  });
  const context = await auth.$context;
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await context.password.hash(PASSWORD),
  });
  const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
  const otherDevice = new AuthCookieJar(jar.origin);
  for (const device of [jar, otherDevice]) {
    expect(
      (await nativeRequest(auth, device, "/sign-in/email", { email, password: PASSWORD })).status,
    ).toBe(200);
  }
  return { auth, jar, otherDevice, userId, email };
}

describe("native TOTP enrollment and credential challenge", () => {
  test("confirms enrollment, rotates sessions and gates subsequent sign-in until the factor", async () => {
    const { auth, jar, otherDevice, userId, email } = await setup();
    const initialHeaders = jar.headers();
    const enrolled = await nativeRequest(auth, jar, "/two-factor/enable", { password: PASSWORD });
    expect(enrolled.status).toBe(200);
    const enrollment = (await enrolled.json()) as { totpURI: string; backupCodes: string[] };
    expect(enrollment.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.backupCodes).toHaveLength(10);
    const uri = new URL(enrollment.totpURI);
    const secret = base32.decode(uri.searchParams.get("secret") ?? "");
    const otp = createOTP(secret);
    const [pendingFactor] = await h.db
      .select()
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, userId));
    expect(pendingFactor?.verified).toBe(false);
    expect(pendingFactor?.backupCodes).not.toContain(enrollment.backupCodes[0]);
    expect(pendingFactor?.backupCodes).toContain(
      hashRecoveryInput(enrollment.backupCodes[0] ?? ""),
    );
    expect(await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000))).toBeNull();

    const code = await otp.totp();
    const persianCode = code.replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)] ?? digit);
    expect(
      (await nativeRequest(auth, jar, "/two-factor/verify-totp", { code: persianCode })).status,
    ).toBe(200);
    const enrolledSession = await resolveWorkflowSession(
      h.db,
      jar.headers(),
      AbortSignal.timeout(5000),
    );
    expect(enrolledSession?.session.assurance).toBe("mfa");
    expect(enrolledSession?.authUser.twoFactorEnabled).toBe(true);
    expect(enrolledSession?.session.mfaVerifiedAt).not.toBeNull();
    expect(
      await resolveWorkflowSession(h.db, initialHeaders, AbortSignal.timeout(5000)),
    ).toBeNull();

    // A different password session established before enrollment cannot retrieve the confirmed
    // TOTP secret or enroll an attacker-controlled replacement strong factor.
    expect(
      await resolveWorkflowSession(h.db, otherDevice.headers(), AbortSignal.timeout(5000)),
    ).toBeNull();
    expect(
      (await nativeRequest(auth, otherDevice, "/two-factor/get-totp-uri", { password: PASSWORD }))
        .status,
    ).not.toBe(200);
    expect(
      (await nativeRequest(auth, otherDevice, "/passkey/generate-register-options")).status,
    ).not.toBe(200);

    expect((await nativeRequest(auth, jar, "/sign-out", {})).status).toBe(200);
    // A second legitimate verification uses a new timestep; the enrollment code is one-use.
    const realNow = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(realNow + 30_000);
    try {
      const signIn = await nativeRequest(auth, jar, "/sign-in/email", {
        email,
        password: PASSWORD,
      });
      expect(signIn.status).toBe(200);
      expect(await signIn.json()).toMatchObject({ twoFactorRedirect: true });
      expect(
        await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000)),
      ).toBeNull();
      const nextCode = await otp.totp();
      const wrongCode = `${(Number(nextCode[0]) + 1) % 10}${nextCode.slice(1)}`;
      expect(
        (await nativeRequest(auth, jar, "/two-factor/verify-totp", { code: wrongCode })).status,
      ).not.toBe(200);
      expect(
        await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000)),
      ).toBeNull();
      const pendingHeaders = jar.headers();
      const verified = await nativeRequest(auth, jar, "/two-factor/verify-totp", {
        code: nextCode,
        trustDevice: true,
      });
      expect(verified.status).toBe(200);
      expect(verified.headers.getSetCookie().some((value) => value.includes("trust_device"))).toBe(
        false,
      );
      expect(
        (await resolveWorkflowSession(h.db, jar.headers(), AbortSignal.timeout(5000)))?.session
          .assurance,
      ).toBe("mfa");
      const replay = await auth.handler(
        new Request(`${jar.origin}/api/auth/two-factor/verify-totp`, {
          method: "POST",
          headers: pendingHeaders,
          body: JSON.stringify({ code: nextCode }),
        }),
      );
      expect(replay.status).not.toBe(200);
    } finally {
      clock.mockRestore();
    }
  });

  test("a successful TOTP cannot unlock an independent challenge twice or renew freshness", async () => {
    const { auth, jar, otherDevice, email } = await setup();
    const enabled = await nativeRequest(auth, jar, "/two-factor/enable", { password: PASSWORD });
    const uri = new URL(((await enabled.json()) as { totpURI: string }).totpURI);
    const otp = createOTP(base32.decode(uri.searchParams.get("secret") ?? ""));
    expect(
      (await nativeRequest(auth, jar, "/two-factor/verify-totp", { code: await otp.totp() }))
        .status,
    ).toBe(200);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_000);
    try {
      await nativeRequest(auth, jar, "/sign-out", {});
      for (const device of [jar, otherDevice]) {
        expect(
          await (
            await nativeRequest(auth, device, "/sign-in/email", { email, password: PASSWORD })
          ).json(),
        ).toMatchObject({ twoFactorRedirect: true });
      }
      const code = await otp.totp();
      const outcomes = await Promise.all(
        [jar, otherDevice].map((device) =>
          nativeRequest(auth, device, "/two-factor/verify-totp", { code }),
        ),
      );
      expect(outcomes.filter((response) => response.status === 200)).toHaveLength(1);
      const denied = outcomes.find((response) => response.status !== 200);
      expect(await denied?.json()).toMatchObject({ code: "INVALID_CODE" });
      const authorized = await Promise.all(
        [jar, otherDevice].map((device) =>
          resolveWorkflowSession(h.db, device.headers(), AbortSignal.timeout(5000)),
        ),
      );
      expect(authorized.filter((session) => session !== null)).toHaveLength(1);
      const winner = authorized[0] === null ? otherDevice : jar;
      const original = await resolveWorkflowSession(
        h.db,
        winner.headers(),
        AbortSignal.timeout(5000),
      );
      expect(
        (await nativeRequest(auth, winner, "/two-factor/verify-totp", { code })).status,
      ).not.toBe(200);
      const after = await resolveWorkflowSession(h.db, winner.headers(), AbortSignal.timeout(5000));
      expect(after?.session.id).toBe(original?.session.id);
      expect(after?.session.mfaVerifiedAt).toEqual(original?.session.mfaVerifiedAt);
    } finally {
      clock.mockRestore();
    }
  });
});
