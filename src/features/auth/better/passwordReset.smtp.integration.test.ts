import { randomUUID } from "node:crypto";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type * as EnvModule from "@/config/env";
import { env } from "@/config/env";
import {
  authAccounts,
  authMailOutbox,
  authPasskeys,
  authTwoFactors,
  authUsers,
  users,
} from "@/db/schema";
import { dispatchAuthMail } from "@/features/auth/management/mail";
import { renderAuthMail } from "@/features/auth/management/mailTemplates";
import { decryptToken } from "@/features/email/crypto";
import { decodedSmtpBody, startAuthSmtpSink } from "@/test/authSmtpSink";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { nativeAuthGateway } from "./nativeGateway";
import {
  AuthCookieJar,
  nativeRequest,
  type RegistrationOptions,
  registrationResponse,
  syntheticAuthenticator,
} from "./passkey.protocol.test-helpers";
import { resolveWorkflowSession } from "./sessionPolicy";

const { smtp } = vi.hoisted(() => ({ smtp: { port: 0 } }));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return {
    ...actual,
    env: {
      ...actual.env,
      AUTH_MAIL_TRANSPORT: "smtp",
      AUTH_SMTP_HOST: "127.0.0.1",
      AUTH_SMTP_SECURE: false,
      AUTH_SMTP_USER: "",
      AUTH_SMTP_PASSWORD: "",
      get AUTH_SMTP_PORT() {
        return smtp.port;
      },
    },
  };
});
const PASSWORD = "Initial-local-reset-qualification-password";
const NEXT_PASSWORD = "Replacement-local-reset-qualification-password";
let h: TestDb;
let sink: Awaited<ReturnType<typeof startAuthSmtpSink>>;
beforeAll(async () => {
  h = await makeTestDb();
  sink = await startAuthSmtpSink();
  smtp.port = sink.port;
});
afterAll(async () => {
  await sink.close();
  await h.close();
});

async function post(jar: AuthCookieJar, path: string, body: Record<string, unknown>) {
  const response = await nativeAuthGateway(
    h.db,
    new Request(`${jar.origin}/api/auth${path}`, {
      method: "POST",
      headers: jar.headers(),
      body: JSON.stringify(body),
    }),
  );
  jar.apply(response);
  return response;
}

async function setup(locale: "fa" | "de") {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  await h.db.insert(users).values({ id: userId, email, name: "Local reset qualification" });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "Local reset qualification", emailVerified: true });
  const auth = createBetterAuth(h.db);
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await (await auth.$context).password.hash(PASSWORD),
  });
  const jar = new AuthCookieJar(new URL(env.BASE_URL).origin);
  jar.apply(
    new Response(null, { headers: { "set-cookie": `warpdrive_locale=${locale}; Path=/` } }),
  );
  expect((await post(jar, "/sign-in/email", { email, password: PASSWORD })).status).toBe(200);
  const enabled = await post(jar, "/two-factor/enable", { password: PASSWORD });
  expect(enabled.status).toBe(200);
  const enrollment = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
  const otp = createOTP(
    base32.decode(new URL(enrollment.totpURI).searchParams.get("secret") ?? ""),
  );
  expect((await post(jar, "/two-factor/verify-totp", { code: await otp.totp() })).status).toBe(200);
  const options = await nativeRequest(
    { handler: (request) => nativeAuthGateway(h.db, request) },
    jar,
    "/passkey/generate-register-options",
  );
  expect(options.status).toBe(200);
  const response = registrationResponse(
    syntheticAuthenticator(),
    (await options.json()) as RegistrationOptions,
    jar.origin,
  );
  expect((await post(jar, "/passkey/verify-registration", { response })).status).toBe(200);
  return { jar, userId, email, codes: enrollment.backupCodes };
}

describe.each(["fa", "de"] as const)("%s reset through local SMTP", (locale) => {
  test("delivers the actual reset link, revokes sessions, retains factors, and requires one-use recovery proof", async () => {
    const f = await setup(locale);
    const oldHeaders = f.jar.headers();
    const [factorBefore] = await h.db
      .select()
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, f.userId));
    const keysBefore = await h.db
      .select()
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, f.userId));
    expect(
      await resolveWorkflowSession(h.db, oldHeaders, AbortSignal.timeout(5000)),
    ).not.toBeNull();
    const anonymous = new AuthCookieJar(f.jar.origin);
    anonymous.apply(
      new Response(null, { headers: { "set-cookie": `warpdrive_locale=${locale}; Path=/` } }),
    );
    expect(
      (
        await post(anonymous, "/request-password-reset", {
          email: f.email,
          redirectTo: "/auth/reset-password",
        })
      ).status,
    ).toBe(200);
    const [mail] = await h.db
      .select()
      .from(authMailOutbox)
      .where(and(eq(authMailOutbox.userId, f.userId), eq(authMailOutbox.kind, "password_reset")));
    expect(mail?.locale).toBe(locale);
    const decrypted = decryptToken(mail!.payloadEnc);
    expect(decrypted.ok).toBe(true);
    if (!decrypted.ok) return;
    const payload = JSON.parse(decrypted.value) as { url: string };
    expect((await dispatchAuthMail(h.db, AbortSignal.timeout(20_000))).failed).toBe(0);
    const wire = sink.messages.find(
      (message) =>
        message.recipient === f.email && decodedSmtpBody(message.raw).includes(payload.url),
    );
    expect(wire).toBeDefined();
    const body = decodedSmtpBody(wire!.raw);
    expect(body).toContain(`lang="${locale}" dir="${locale === "fa" ? "rtl" : "ltr"}"`);
    expect(body).toContain(
      renderAuthMail({ recipient: f.email, locale, kind: "password_reset" }).text.split("\n")[0],
    );
    const [delivered] = await h.db
      .select()
      .from(authMailOutbox)
      .where(eq(authMailOutbox.id, mail!.id));
    expect(delivered?.status).toBe("sent");
    const opened = await nativeAuthGateway(h.db, new Request(payload.url));
    expect(opened.status).toBe(302);
    const destination = new URL(opened.headers.get("location") ?? "", f.jar.origin);
    expect(destination.origin).toBe(f.jar.origin);
    expect(destination.pathname).toBe("/auth/reset-password");
    const token = destination.searchParams.get("token");
    expect(token).not.toBeNull();
    expect(
      (await post(anonymous, "/reset-password", { token, newPassword: NEXT_PASSWORD })).status,
    ).toBe(200);
    expect(await resolveWorkflowSession(h.db, oldHeaders, AbortSignal.timeout(5000))).toBeNull();
    expect(
      await resolveWorkflowSession(h.db, anonymous.headers(), AbortSignal.timeout(5000)),
    ).toBeNull();
    const [factorAfter] = await h.db
      .select()
      .from(authTwoFactors)
      .where(eq(authTwoFactors.userId, f.userId));
    expect(factorAfter).toEqual(factorBefore);
    expect(await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, f.userId))).toEqual(
      keysBefore,
    );
    expect(
      (await post(anonymous, "/reset-password", { token, newPassword: PASSWORD })).status,
    ).toBe(400);
    expect(
      (await post(anonymous, "/sign-in/email", { email: f.email, password: PASSWORD })).status,
    ).toBe(401);
    const login = await post(anonymous, "/sign-in/email", {
      email: f.email,
      password: NEXT_PASSWORD,
    });
    expect(await login.json()).toMatchObject({ twoFactorRedirect: true });
    expect(
      await resolveWorkflowSession(h.db, anonymous.headers(), AbortSignal.timeout(5000)),
    ).toBeNull();
    expect(
      (await post(anonymous, "/two-factor/verify-backup-code", { code: f.codes[0] })).status,
    ).toBe(200);
    expect(
      (await resolveWorkflowSession(h.db, anonymous.headers(), AbortSignal.timeout(5000)))?.session
        .assurance,
    ).toBe("mfa");
    const replayJar = new AuthCookieJar(f.jar.origin);
    expect(
      (await post(replayJar, "/sign-in/email", { email: f.email, password: NEXT_PASSWORD })).status,
    ).toBe(200);
    expect(
      (await post(replayJar, "/two-factor/verify-backup-code", { code: f.codes[0] })).status,
    ).toBe(401);
  });
});
