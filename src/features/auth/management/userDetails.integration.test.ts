import { afterAll, beforeAll, expect, test } from "vitest";
import { authUsers, sessions, users } from "@/db/schema";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { readManagedUserDetails } from "./userDetails";

let h: TestDb;
const admin: PermSetUser = {
  id: "00000000-0000-4000-8000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const targetId = "00000000-0000-4000-8000-0000000000bb";
beforeAll(async () => {
  h = await makeTestDb();
  await h.db.insert(users).values([
    { id: admin.id, name: "Admin", email: "admin@example.com", isAdmin: true },
    { id: targetId, name: "Member", email: "member@example.com" },
  ]);
  await h.db.insert(authUsers).values({
    id: targetId,
    email: "member@example.com",
    name: "Member",
    emailVerified: true,
    twoFactorEnabled: true,
  });
  await h.db.insert(sessions).values({
    userId: targetId,
    tokenHash: "never-expose-this-hash",
    expiresAt: new Date(Date.now() + 60_000),
    userAgent: "Test browser",
  });
});
afterAll(async () => {
  await h.close();
});
test("only an administrator can inspect security details and session identifiers are not bearer tokens", async () => {
  const manager: PermSetUser = {
    ...admin,
    type: "regular",
    flags: new Set(["permissions.manage"]),
  };
  expect(
    (await readManagedUserDetails(h.db, manager, targetId, AbortSignal.timeout(10000))).ok,
  ).toBe(false);
  const result = await readManagedUserDetails(h.db, admin, targetId, AbortSignal.timeout(10000));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.emailVerified).toBe(true);
  expect(result.value.twoFactorEnabled).toBe(true);
  expect(result.value.sessions).toHaveLength(1);
  expect(JSON.stringify(result.value)).not.toContain("never-expose-this-hash");
});
