import { afterAll, beforeAll, expect, test } from "vitest";
import { users } from "@/db/schema";
import { authRecoveryRequests } from "@/db/schema/authManagement";
import { encryptToken } from "@/features/email/crypto";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { recordSecurityEvent } from "./audit";
import { readManagementSnapshot } from "./directory";

let h: TestDb;
const signal = () => AbortSignal.timeout(10000);
const admin: PermSetUser = {
  id: "00000000-0000-0000-0000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const regular: PermSetUser = {
  id: "00000000-0000-0000-0000-0000000000bb",
  type: "regular",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
beforeAll(async () => {
  h = await makeTestDb();
  await h.db.insert(users).values([
    { id: admin.id, name: "Admin", email: "admin@example.com", isAdmin: true },
    { id: regular.id, name: "Member", email: "member@example.com" },
  ]);
});
afterAll(async () => {
  await h.close();
});
test("user administration denies a regular caller and returns only safe management data for an administrator", async () => {
  expect(
    (await readManagementSnapshot(h.db, regular, { q: "", status: "all", page: 1 }, signal())).ok,
  ).toBe(false);
  const result = await readManagementSnapshot(
    h.db,
    admin,
    { q: "member", status: "all", page: 1 },
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.users).toHaveLength(1);
  expect(result.value.users[0]!.email).toBe("member@example.com");
  const serialized = JSON.stringify(result.value);
  expect(serialized).not.toContain("tokenHash");
  expect(serialized).not.toContain("payloadEnc");
  expect(serialized).not.toContain("backupCodes");
});

test("audit search includes the affected person and preserves the outcome filter", async () => {
  await recordSecurityEvent(
    h.db,
    { actorId: admin.id, targetUserId: regular.id, action: "user.deactivate", outcome: "success" },
    signal(),
  );
  await recordSecurityEvent(
    h.db,
    { actorId: admin.id, targetUserId: regular.id, action: "user.activate", outcome: "denied" },
    signal(),
  );
  const result = await readManagementSnapshot(
    h.db,
    admin,
    { q: "", status: "all", page: 1, auditQ: "Member", auditOutcome: "success", auditPage: 1 },
    signal(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.audit).toHaveLength(1);
  expect(result.value.audit[0]!.targetName).toBe("Member");
  expect(result.value.audit[0]!.actorName).toBe("Admin");
});

test("closure context is encrypted at rest and visible only in the administrator review DTO", async () => {
  const reason = "برای جابه‌جایی مسئولیت‌ها درخواست بستن حساب دارم.";
  const [stored] = await h.db
    .insert(authRecoveryRequests)
    .values({ userId: regular.id, kind: "account_closure", reasonEnc: encryptToken(reason) })
    .returning();
  expect(stored!.reasonEnc).toBeInstanceOf(Buffer);
  expect(stored!.reasonEnc!.toString()).not.toContain(reason);
  const result = await readManagementSnapshot(
    h.db,
    admin,
    { q: "", status: "all", page: 1 },
    signal(),
  );
  expect(result.ok && result.value.requests[0]?.reason).toBe(reason);
  const manager = { ...regular, flags: new Set(["permissions.manage"] as const) };
  const limited = await readManagementSnapshot(
    h.db,
    manager,
    { q: "", status: "all", page: 1 },
    signal(),
  );
  expect(limited.ok && limited.value.requests).toEqual([]);
});
