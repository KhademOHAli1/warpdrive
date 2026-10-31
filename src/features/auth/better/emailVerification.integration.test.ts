import { randomUUID } from "node:crypto";
import { createAuthClient } from "better-auth/client";
import { and, desc, eq, sql } from "drizzle-orm";
import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { env } from "@/config/env";
import {
  authAccounts,
  authEmailVerificationTokens,
  authMailOutbox,
  authUsers,
  users,
} from "@/db/schema";
import { decryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { verificationNextStep } from "../ui/authUiModel";
import { createBetterAuth } from "./auth";
import { nativeAuthGateway } from "./nativeGateway";
import { AuthCookieJar, nativeRequest } from "./passkey.protocol.test-helpers";

let h: TestDb;
const PASSWORD = "A-verification-link-binding-password";
const config = {
  ...env,
  AUTH_SECRET: "verification-binding-secret-over-thirty-two-characters",
  AUTH_GOOGLE_ENABLED: false,
};
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
async function setup(verified = false) {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  await h.db.insert(users).values({ id: userId, email, name: "Verification owner" });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "Verification owner", emailVerified: verified });
  const context = await createBetterAuth(h.db, config).$context;
  await h.db.insert(authAccounts).values({
    userId,
    providerId: "credential",
    accountId: userId,
    password: await context.password.hash(PASSWORD),
  });
  const auth = { handler: (request: Request) => nativeAuthGateway(h.db, request, config) };
  const jar = new AuthCookieJar(new URL(config.BASE_URL).origin);
  if (verified)
    expect(
      (await nativeRequest(auth, jar, "/sign-in/email", { email, password: PASSWORD })).status,
    ).toBe(200);
  return { auth, jar, userId, email };
}
async function newestUrl(userId: string, recipient: string): Promise<string> {
  const [message] = await h.db
    .select()
    .from(authMailOutbox)
    .where(
      and(
        eq(authMailOutbox.userId, userId),
        eq(authMailOutbox.recipient, recipient),
        eq(authMailOutbox.kind, "verification"),
      ),
    )
    .orderBy(desc(authMailOutbox.createdAt), desc(authMailOutbox.id))
    .limit(1);
  if (!message) throw new Error("Verification message missing");
  const payload = decryptToken(message.payloadEnc);
  if (!payload.ok) throw new Error("Encrypted verification message unreadable");
  return (JSON.parse(payload.value) as { url: string }).url;
}
async function requestVerification(f: Awaited<ReturnType<typeof setup>>) {
  expect(
    (
      await nativeRequest(f.auth, f.jar, "/send-verification-email", {
        email: f.email,
        callbackURL: "/auth/continue",
      })
    ).status,
  ).toBe(200);
  return newestUrl(f.userId, f.email);
}
async function visit(f: Awaited<ReturnType<typeof setup>>, rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.pathname === "/auth/verify-email") url.pathname = "/api/auth/verify-email";
  url.searchParams.delete("callbackURL");
  const response = await f.auth.handler(new Request(url, { headers: f.jar.headers() }));
  f.jar.apply(response);
  return response;
}
async function identity(userId: string) {
  const [user] = await h.db.select().from(authUsers).where(eq(authUsers.id, userId));
  if (!user) throw new Error("Test identity missing");
  return user;
}

describe("verification links are single-use and bound to their immutable auth identity", () => {
  test("verifies the original identity once and rejects replay", async () => {
    const f = await setup();
    const url = await requestVerification(f);
    expect((await visit(f, url)).status).toBe(200);
    expect((await identity(f.userId)).emailVerified).toBe(true);
    const [binding] = await h.db
      .select()
      .from(authEmailVerificationTokens)
      .where(eq(authEmailVerificationTokens.userId, f.userId));
    expect(binding?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(binding?.consumedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(binding)).not.toContain(new URL(url).searchParams.get("token"));
    expect((await visit(f, url)).status).not.toBe(200);
  });

  test("resending replaces an earlier verification link", async () => {
    const f = await setup();
    const first = await requestVerification(f);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 2_000));
    let replacement: string;
    try {
      replacement = await requestVerification(f);
    } finally {
      vi.useRealTimers();
    }
    expect(replacement).not.toBe(first);
    expect((await visit(f, first)).status).not.toBe(200);
    expect((await identity(f.userId)).emailVerified).toBe(false);
    expect((await visit(f, replacement)).status).toBe(200);
  });

  test("a token cannot verify a different invited UUID after the email address is reassigned", async () => {
    const f = await setup();
    const stale = await requestVerification(f);
    const movedEmail = `${randomUUID()}@example.com`;
    await h.db.update(users).set({ email: movedEmail }).where(eq(users.id, f.userId));
    await h.db.update(authUsers).set({ email: movedEmail }).where(eq(authUsers.id, f.userId));
    const replacementId = randomUUID();
    await h.db.insert(users).values({
      id: replacementId,
      email: f.email,
      name: "Replacement invitation",
      invitedAt: new Date(),
    });
    await h.db.insert(authUsers).values({
      id: replacementId,
      email: f.email,
      name: "Replacement invitation",
      emailVerified: false,
    });
    expect((await visit(f, stale)).status).not.toBe(200);
    expect((await identity(replacementId)).emailVerified).toBe(false);
  });

  test("old-address confirmation and new-address verification are each one use", async () => {
    const f = await setup(true);
    const target = `${randomUUID()}@example.com`;
    expect(
      (
        await nativeRequest(f.auth, f.jar, "/change-email", {
          newEmail: target,
          callbackURL: "/auth/continue",
        })
      ).status,
    ).toBe(200);
    const confirmation = await newestUrl(f.userId, f.email);
    expect((await visit(f, confirmation)).status).toBe(200);
    const verification = await newestUrl(f.userId, target);
    expect((await identity(f.userId)).email).toBe(f.email);
    expect((await visit(f, confirmation)).status).not.toBe(200);
    expect((await visit(f, verification)).status).toBe(200);
    expect((await identity(f.userId)).email).toBe(target);
    expect((await visit(f, verification)).status).not.toBe(200);
  });

  test("a failed native email mutation leaves the verification grant unconsumed", async () => {
    const f = await setup(true);
    const target = `${randomUUID()}@example.com`;
    await nativeRequest(f.auth, f.jar, "/change-email", { newEmail: target });
    await visit(f, await newestUrl(f.userId, f.email));
    const verification = await newestUrl(f.userId, target);
    const blocker = randomUUID();
    await h.db.insert(users).values({ id: blocker, email: target, name: "Collision" });
    await h.db
      .insert(authUsers)
      .values({ id: blocker, email: target, name: "Collision", emailVerified: true });
    const failed = await visit(f, verification).catch(() => new Response(null, { status: 500 }));
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect((await identity(f.userId)).email).toBe(f.email);
    await h.db.delete(authUsers).where(eq(authUsers.id, blocker));
    await h.db.delete(users).where(eq(users.id, blocker));
    expect((await visit(f, verification)).status).toBe(200);
    expect((await identity(f.userId)).email).toBe(target);
  });

  test("concurrent redemption admits exactly one request", async () => {
    const f = await setup();
    const url = await requestVerification(f);
    const results = await Promise.all([visit(f, url), visit(f, url)]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
  });

  test("a different signed-in account cannot redeem the link or create cross-account locks", async () => {
    const signedIn = await setup(true);
    const intended = await setup();
    const url = await requestVerification(intended);
    const mismatch = await visit({ ...intended, jar: signedIn.jar }, url);
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({ code: "VERIFICATION_ACCOUNT_MISMATCH" });
    expect((await identity(intended.userId)).emailVerified).toBe(false);
    expect((await visit(intended, url)).status).toBe(200);
  });

  test("mail lands in the localized app and the real client handles both email-change steps as JSON", async () => {
    const f = await setup(true);
    const target = `${randomUUID()}@example.com`;
    await nativeRequest(f.auth, f.jar, "/change-email", { newEmail: target });
    const confirmation = new URL(await newestUrl(f.userId, f.email));
    expect(confirmation.pathname).toBe("/auth/verify-email");
    const client = createAuthClient({
      baseURL: config.BASE_URL,
      fetchOptions: {
        customFetchImpl: async (input, init) => {
          const request = new Request(input, init);
          expect(new URL(request.url).searchParams.has("callbackURL")).toBe(false);
          const headers = new Headers(request.headers);
          for (const [key, value] of f.jar.headers()) headers.set(key, value);
          const response = await f.auth.handler(new Request(request, { headers }));
          f.jar.apply(response);
          expect(response.headers.get("content-type")).toContain("application/json");
          return response;
        },
      },
    });
    const first = await client.verifyEmail({
      query: { token: confirmation.searchParams.get("token") ?? "" },
    });
    expect(first.error).toBeNull();
    expect(first.data).toEqual({ status: true });
    expect(verificationNextStep(first.data)).toBe("check_new_email");
    expect((await identity(f.userId)).email).toBe(f.email);
    const verification = new URL(await newestUrl(f.userId, target));
    expect(verification.pathname).toBe("/auth/verify-email");
    const second = await client.verifyEmail({
      query: { token: verification.searchParams.get("token") ?? "" },
    });
    expect(second.error).toBeNull();
    expect(verificationNextStep(second.data)).toBe("continue");
    expect(second.data).toMatchObject({
      status: true,
      user: { id: f.userId, email: target, emailVerified: true },
    });
    expect((await identity(f.userId)).email).toBe(target);
  });

  test("a failed encrypted-outbox enqueue rolls back confirmation and permits retry", async () => {
    const f = await setup(true);
    const target = `${randomUUID()}@example.com`;
    await nativeRequest(f.auth, f.jar, "/change-email", { newEmail: target });
    const confirmation = await newestUrl(f.userId, f.email);
    await h.db.execute(
      sql`CREATE FUNCTION reject_verification_mail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind = 'verification' THEN RAISE EXCEPTION 'mail_enqueue_qualification_failure'; END IF; RETURN NEW; END; $$`,
    );
    await h.db.execute(
      sql`CREATE TRIGGER reject_verification_mail BEFORE INSERT ON auth_mail_outbox FOR EACH ROW EXECUTE FUNCTION reject_verification_mail()`,
    );
    try {
      expect((await visit(f, confirmation)).status).toBe(500);
      const rows = await h.db
        .select()
        .from(authEmailVerificationTokens)
        .where(eq(authEmailVerificationTokens.userId, f.userId));
      expect(rows.every((row) => row.consumedAt === null)).toBe(true);
    } finally {
      await h.db.execute(sql`DROP TRIGGER reject_verification_mail ON auth_mail_outbox`);
      await h.db.execute(sql`DROP FUNCTION reject_verification_mail()`);
    }
    expect((await visit(f, confirmation)).status).toBe(200);
    expect((await visit(f, await newestUrl(f.userId, target))).status).toBe(200);
  });

  test("tampered, expired and unbound signed tokens cannot verify or consume a valid grant", async () => {
    const f = await setup();
    const original = await requestVerification(f);
    const changed = new URL(original);
    const token = changed.searchParams.get("token") ?? "";
    const parts = token.split(".");
    const signature = parts[2] ?? "";
    parts[2] = `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
    changed.searchParams.set("token", parts.join("."));
    expect((await visit(f, changed.toString())).status).not.toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 3_600_000));
    try {
      expect((await visit(f, original)).status).not.toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const unbound = await new SignJWT({ email: f.email })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("20m")
      .sign(new TextEncoder().encode(config.AUTH_SECRET));
    changed.searchParams.set("token", unbound);
    expect((await visit(f, changed.toString())).status).not.toBe(200);
    expect((await identity(f.userId)).emailVerified).toBe(false);
    expect((await visit(f, original)).status).toBe(200);
  });
});
