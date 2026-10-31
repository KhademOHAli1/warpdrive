import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { authUsers, sessions, users } from "@/db/schema";
import { loadLiveSessionById, loadLiveSessionByToken } from "@/features/auth/session";
import { makeTestDb, type TestDb } from "@/test/db";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("pending administrator session is confined to enrollment and cannot satisfy fresh privileged access", async () => {
  const [user] = await h.db
    .insert(users)
    .values({ email: "admin-auth@example.com", name: "Admin", isAdmin: true })
    .returning();
  await h.db
    .insert(authUsers)
    .values({ id: user!.id, email: user!.email, name: user!.name, emailVerified: true });
  const raw = randomBytes(32).toString("base64url");
  const [session] = await h.db
    .insert(sessions)
    .values({
      userId: user!.id,
      tokenHash: createHash("sha256").update(raw).digest("base64url"),
      expiresAt: new Date(Date.now() + 3_600_000),
      authMethod: "password",
      assurance: "password",
      freshAuthenticatedAt: new Date(),
    })
    .returning();
  const headers = new Headers({ cookie: `wd_sid=${raw}.signed-cookie-envelope` });
  expect((await loadLiveSessionByToken(h.db, raw, AbortSignal.timeout(5000))).ok).toBe(false);
  expect((await loadLiveSessionById(h.db, session!.id, AbortSignal.timeout(5000))).ok).toBe(false);
  expect(await resolveWorkflowSession(h.db, headers, AbortSignal.timeout(5000))).toBeNull();
  expect(
    await resolveWorkflowSession(h.db, headers, AbortSignal.timeout(5000), { allowPending: true }),
  ).not.toBeNull();
  expect(
    await resolveWorkflowSession(h.db, headers, AbortSignal.timeout(5000), { requireFresh: true }),
  ).toBeNull();
  await h.db
    .update(sessions)
    .set({ assurance: "mfa", mfaVerifiedAt: new Date() })
    .where(eq(sessions.id, session!.id));
  expect(
    (await loadLiveSessionByToken(h.db, `${raw}.signed-cookie-envelope`, AbortSignal.timeout(5000)))
      .ok,
  ).toBe(true);
  expect(
    await resolveWorkflowSession(h.db, headers, AbortSignal.timeout(5000), { requireFresh: true }),
  ).not.toBeNull();
  await h.db
    .update(sessions)
    .set({ freshAuthenticatedAt: new Date(), mfaVerifiedAt: new Date(Date.now() - 600_000) })
    .where(eq(sessions.id, session!.id));
  expect(
    await resolveWorkflowSession(h.db, headers, AbortSignal.timeout(5000), { requireFresh: true }),
  ).toBeNull();
  await h.db.update(users).set({ isActive: false }).where(eq(users.id, user!.id));
  expect(
    await resolveWorkflowSession(h.db, headers, AbortSignal.timeout(5000), { allowPending: true }),
  ).toBeNull();
});
