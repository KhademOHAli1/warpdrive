import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { auditEvents, permissionSets, sessions, userPreferences, users } from "@/db/schema";
import { authMailOutbox, authSecurityEvents } from "@/db/schema/authManagement";
import { recordAudit } from "@/features/identity/audit";
import {
  assignPermissionSet,
  setUserActive,
  setUserAdmin,
} from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { revokeManagedUserAccess } from "./administration";
import { revokeManagedSession } from "./userDetails";

let h: TestDb;
const admin: PermSetUser = {
  id: "00000000-0000-4000-8000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const userId = "00000000-0000-4000-8000-0000000000bb";
const setId = "00000000-0000-4000-8000-0000000000cc";
const signal = () => AbortSignal.timeout(10000);
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE users, permission_sets RESTART IDENTITY CASCADE`);
  await h.db.insert(users).values([
    { id: admin.id, name: "Admin", email: "admin@example.com", isAdmin: true },
    { id: userId, name: "Member", email: "member@example.com" },
  ]);
  await h.db.insert(permissionSets).values({ id: setId, name: "Standard", flags: {} });
  await h.db.insert(userPreferences).values({
    userId,
    ui: {
      localePreferences: {
        locale: "fa",
        calendar: "persian",
        timeZone: "Asia/Tehran",
        numberingSystem: "arabext",
      },
    },
  });
});
test("legacy user access changes are visible in the auth audit and queue Persian notices", async () => {
  expect((await assignPermissionSet(h.db, admin, { userId, setId }, signal())).ok).toBe(true);
  expect((await setUserAdmin(h.db, admin, { userId, isAdmin: true }, signal())).ok).toBe(true);
  expect((await setUserActive(h.db, admin, { userId, isActive: false }, signal())).ok).toBe(true);
  expect((await setUserActive(h.db, admin, { userId, isActive: true }, signal())).ok).toBe(true);
  const events = await h.db
    .select()
    .from(authSecurityEvents)
    .where(eq(authSecurityEvents.targetUserId, userId));
  expect(events.map((event) => event.action).sort()).toEqual([
    "user.activate",
    "user.assign_permission_set",
    "user.deactivate",
    "user.set_admin",
  ]);
  const messages = await h.db
    .select()
    .from(authMailOutbox)
    .where(eq(authMailOutbox.userId, userId));
  expect(messages).toHaveLength(4);
  expect(messages.every((message) => message.locale === "fa")).toBe(true);
});
test("permission audit mirrors only safe structured metadata", async () => {
  await recordAudit(
    h.db,
    {
      actorId: admin.id,
      targetType: "permission_set",
      targetId: setId,
      action: "permission_set.update",
      before: { secret: "private-before" },
      after: { secret: "private-after", name: "private-name" },
    },
    signal(),
  );
  const [event] = await h.db.select().from(authSecurityEvents);
  expect(event?.action).toBe("permission_set.update");
  expect(JSON.stringify(event)).not.toContain("private-");
});
test("administrator session and grant revocations notify the owner in their own German locale", async () => {
  await h.db
    .update(userPreferences)
    .set({
      ui: {
        localePreferences: {
          locale: "de",
          calendar: "gregory",
          timeZone: "Europe/Berlin",
          numberingSystem: "latn",
        },
      },
    })
    .where(eq(userPreferences.userId, userId));
  const [session] = await h.db
    .insert(sessions)
    .values({
      userId,
      tokenHash: "test-admin-notice-session",
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  expect((await revokeManagedSession(h.db, admin, userId, session!.id, signal())).ok).toBe(true);
  expect((await revokeManagedUserAccess(h.db, admin, userId, signal())).ok).toBe(true);
  const messages = await h.db
    .select()
    .from(authMailOutbox)
    .where(eq(authMailOutbox.userId, userId));
  expect(messages).toHaveLength(2);
  expect(messages.every((message) => message.locale === "de")).toBe(true);
});
test("a failed notice enqueue rolls back the role change and both audit records", async () => {
  await h.db.execute(
    sql`CREATE FUNCTION reject_test_notice() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''test notice failure''; END'`,
  );
  await h.db.execute(
    sql`CREATE TRIGGER reject_test_notice BEFORE INSERT ON auth_mail_outbox FOR EACH ROW EXECUTE FUNCTION reject_test_notice()`,
  );
  try {
    await expect(setUserAdmin(h.db, admin, { userId, isAdmin: true }, signal())).rejects.toThrow();
    const [owner] = await h.db.select().from(users).where(eq(users.id, userId));
    expect(owner!.isAdmin).toBe(false);
    expect(await h.db.select().from(authSecurityEvents)).toHaveLength(0);
    expect(await h.db.select().from(auditEvents)).toHaveLength(0);
  } finally {
    await h.db.execute(sql`DROP TRIGGER reject_test_notice ON auth_mail_outbox`);
  }
});
