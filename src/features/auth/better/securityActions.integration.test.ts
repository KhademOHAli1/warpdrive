import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authRecoveryRequests, authUsers, sessions, users } from "@/db/schema";
import { decryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { runSecurityAction } from "./securityActions";
import { hashSessionCredential } from "./sessionToken";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("session actions require ownership and fresh authentication and expose no bearer tokens", async () => {
  const [user] = await h.db
    .insert(users)
    .values({ email: "session-owner@example.com", name: "Owner" })
    .returning();
  await h.db
    .insert(authUsers)
    .values({ id: user!.id, name: user!.name, email: user!.email, emailVerified: true });
  const raw = randomBytes(32).toString("base64url");
  const [own] = await h.db
    .insert(sessions)
    .values({
      userId: user!.id,
      tokenHash: hashSessionCredential(raw),
      expiresAt: new Date(Date.now() + 3_600_000),
      authMethod: "password",
      assurance: "password",
      freshAuthenticatedAt: new Date(Date.now() - 600_000),
    })
    .returning();
  const headers = new Headers({ cookie: `wd_sid=${raw}`, origin: "https://app.example.com" });
  const auth = createBetterAuth(h.db);
  expect(
    await runSecurityAction(
      h.db,
      auth,
      headers,
      { action: "revokeSession", id: own!.id },
      AbortSignal.timeout(5000),
    ),
  ).toEqual({ ok: false, error: "FRESH_AUTH_REQUIRED" });
  await h.db
    .update(sessions)
    .set({ freshAuthenticatedAt: new Date() })
    .where(eq(sessions.id, own!.id));
  expect(
    (
      await runSecurityAction(
        h.db,
        auth,
        headers,
        { action: "revokeSession", id: "00000000-0000-0000-0000-000000000000" },
        AbortSignal.timeout(5000),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await runSecurityAction(
        h.db,
        auth,
        headers,
        { action: "revokeSession", id: own!.id },
        AbortSignal.timeout(5000),
      )
    ).ok,
  ).toBe(true);
  const [ended] = await h.db.select().from(sessions).where(eq(sessions.id, own!.id));
  expect(ended?.revokedAt).not.toBeNull();
});

test("account closure preserves the review reason encrypted for the administrator", async () => {
  const [user] = await h.db
    .insert(users)
    .values({ email: "closure-reason@example.com", name: "Closure owner" })
    .returning();
  await h.db
    .insert(authUsers)
    .values({ id: user!.id, name: user!.name, email: user!.email, emailVerified: true });
  const raw = randomBytes(32).toString("base64url");
  await h.db.insert(sessions).values({
    userId: user!.id,
    tokenHash: hashSessionCredential(raw),
    expiresAt: new Date(Date.now() + 3_600_000),
    authMethod: "password",
    assurance: "password",
    freshAuthenticatedAt: new Date(),
  });
  const headers = new Headers({ cookie: `wd_sid=${raw}`, origin: "https://app.example.com" });
  const reason = "Please transfer my customer records before closing my account.";
  expect(
    (
      await runSecurityAction(
        h.db,
        createBetterAuth(h.db),
        headers,
        { action: "requestClosure", reason },
        AbortSignal.timeout(5000),
      )
    ).ok,
  ).toBe(true);
  const [request] = await h.db
    .select()
    .from(authRecoveryRequests)
    .where(eq(authRecoveryRequests.userId, user!.id));
  expect(request?.reasonEnc).toBeInstanceOf(Buffer);
  expect(decryptToken(request!.reasonEnc!)).toEqual({ ok: true, value: reason });
  expect(request!.reasonEnc!.toString()).not.toContain(reason);
});
