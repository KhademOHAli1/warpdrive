import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { env } from "@/config/env";
import { authInvitations, authUsers, sessions, users } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";
import { resolveWorkflowSession } from "./sessionPolicy";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});

test("native signup cannot bypass admission and a real invited account keeps its CRM UUID", async () => {
  const auth = createBetterAuth(h.db, {
    ...env,
    AUTH_SECRET: "test-auth-secret-at-least-thirty-two-characters",
    AUTH_GOOGLE_ENABLED: false,
  });
  const headers = new Headers({ origin: env.BASE_URL });
  await expect(
    auth.api.signUpEmail({
      body: { email: "stranger@example.com", name: "Stranger", password: "Long-test-password-42!" },
      headers,
    }),
  ).rejects.toThrow();
  const [inviter] = await h.db
    .insert(users)
    .values({ email: "operator@example.com", name: "Operator", isAdmin: true })
    .returning();
  const [invited] = await h.db
    .insert(users)
    .values({ email: "invited@example.com", name: "Invited", invitedAt: new Date() })
    .returning();
  const token = randomBytes(32).toString("base64url");
  await h.db.insert(authInvitations).values({
    userId: invited!.id,
    email: invited!.email,
    invitedBy: inviter!.id,
    tokenHash: createHash("sha256").update(token).digest("base64url"),
    expiresAt: new Date(Date.now() + 60_000),
  });
  headers.set("cookie", `wd_invite=${token}`);
  const result = await auth.api.signUpEmail({
    body: { email: invited!.email, name: "Invited", password: "Long-test-password-42!" },
    headers,
  });
  expect(result.user.id).toBe(invited!.id);
  const [identity] = await h.db.select().from(authUsers).where(eq(authUsers.id, invited!.id));
  expect(identity?.emailVerified).toBe(false);
  const [invitation] = await h.db
    .select()
    .from(authInvitations)
    .where(eq(authInvitations.userId, invited!.id));
  expect(invitation?.acceptedAt).not.toBeNull();
  await h.db.update(authUsers).set({ emailVerified: true }).where(eq(authUsers.id, invited!.id));
  const response = await auth.api.signInEmail({
    body: { email: invited!.email, password: "Long-test-password-42!" },
    headers: new Headers({ origin: env.BASE_URL }),
    asResponse: true,
  });
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("wd_sid="))
    ?.split(";")[0];
  expect(cookie).toBeDefined();
  const stored = await h.db.select().from(sessions).where(eq(sessions.userId, invited!.id));
  expect(stored[0]?.assurance).toBe("password");
  const session = await resolveWorkflowSession(
    h.db,
    new Headers({ cookie: cookie ?? "" }),
    AbortSignal.timeout(5000),
  );
  expect(session?.user.id).toBe(invited!.id);
});
