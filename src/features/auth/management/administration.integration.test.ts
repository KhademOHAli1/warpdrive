import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { sessions, users } from "@/db/schema";
import { authRecoveryRequests } from "@/db/schema/authManagement";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { reviewRecoveryRequest } from "./administration";

let h: TestDb;
const admin: PermSetUser = {
  id: "00000000-0000-0000-0000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
beforeAll(async () => {
  h = await makeTestDb();
  await h.db.insert(users).values([
    { id: admin.id, name: "Admin", email: "admin@example.com", isAdmin: true },
    { id: "00000000-0000-4000-8000-0000000000bb", name: "Member", email: "member@example.com" },
  ]);
});
test("reviewing an approved factor recovery cannot bypass host-operator completion", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId: "00000000-0000-4000-8000-0000000000bb",
      kind: "factor_recovery",
      status: "approved",
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    })
    .returning();
  expect(
    (await reviewRecoveryRequest(h.db, admin, request!.id, "resolved", AbortSignal.timeout(10000)))
      .ok,
  ).toBe(false);
});
test("an unapproved account closure cannot be marked complete", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({ userId: "00000000-0000-4000-8000-0000000000bb", kind: "account_closure" })
    .returning();
  expect(
    (await reviewRecoveryRequest(h.db, admin, request!.id, "resolved", AbortSignal.timeout(10000)))
      .ok,
  ).toBe(false);
});
test("completing an approved closure actually suspends the owner and revokes active sessions", async () => {
  const userId = "00000000-0000-4000-8000-0000000000bb";
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId,
      kind: "account_closure",
      status: "approved",
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    })
    .returning();
  await h.db
    .insert(sessions)
    .values({ userId, tokenHash: "closure-test-digest", expiresAt: new Date(Date.now() + 60_000) });
  expect(
    (await reviewRecoveryRequest(h.db, admin, request!.id, "resolved", AbortSignal.timeout(10000)))
      .ok,
  ).toBe(true);
  const [owner] = await h.db.select().from(users).where(eq(users.id, userId));
  const [session] = await h.db.select().from(sessions).where(eq(sessions.userId, userId));
  expect(owner!.isActive).toBe(false);
  expect(session!.revokedAt).not.toBeNull();
});
test("account closure preserves the administrator self-suspension safeguard", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId: admin.id,
      kind: "account_closure",
      status: "approved",
      reviewedBy: admin.id,
      reviewedAt: new Date(),
    })
    .returning();
  expect(
    (await reviewRecoveryRequest(h.db, admin, request!.id, "resolved", AbortSignal.timeout(10000)))
      .ok,
  ).toBe(false);
});
afterAll(async () => {
  await h.close();
});
test("an administrator cannot approve their own assisted factor recovery request", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({ userId: admin.id, kind: "factor_recovery" })
    .returning();
  const result = await reviewRecoveryRequest(
    h.db,
    admin,
    request!.id,
    "approved",
    AbortSignal.timeout(10000),
  );
  expect(result.ok).toBe(false);
  const [stored] = await h.db
    .select()
    .from(authRecoveryRequests)
    .where(eq(authRecoveryRequests.id, request!.id));
  expect(stored!.status).toBe("pending");
});
