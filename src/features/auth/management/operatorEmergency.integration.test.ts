import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { authTwoFactors, authUsers, sessions, users } from "@/db/schema";
import {
  authMailOutbox,
  authRecoveryRequests,
  authSecurityEvents,
} from "@/db/schema/authManagement";
import { makeTestDb, type TestDb } from "@/test/db";
import { recoverAccountAsOperator } from "./bootstrapOperator";

let h: TestDb;
const owner = "00000000-0000-4000-8000-0000000000aa";
const signal = () => AbortSignal.timeout(10_000);
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE users CASCADE`);
});
async function setup() {
  await h.db
    .insert(users)
    .values({ id: owner, email: "sole-owner@example.com", name: "Sole owner", isAdmin: true });
  await h.db.insert(authUsers).values({
    id: owner,
    email: "sole-owner@example.com",
    name: "Sole owner",
    emailVerified: true,
    twoFactorEnabled: true,
  });
  await h.db
    .insert(authTwoFactors)
    .values({ userId: owner, secret: "fixture-secret", backupCodes: "fixture-hashes" });
  await h.db.insert(sessions).values({
    userId: owner,
    tokenHash: "old-session-hash",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({ userId: owner, kind: "factor_recovery", status: "pending" })
    .returning();
  return {
    requestId: request!.id,
    operatorConfirmed: true,
    emergencyLastAdministrator: true,
    ownershipConfirmed: true,
  };
}

describe("host emergency ownership attestation for the sole established administrator", () => {
  test("every explicit confirmation is required; ordinary mode cannot approve a pending case", async () => {
    const input = await setup();
    for (const change of [
      { operatorConfirmed: false },
      { ownershipConfirmed: false },
      { emergencyLastAdministrator: false },
    ]) {
      expect((await recoverAccountAsOperator(h.db, { ...input, ...change }, signal())).ok).toBe(
        false,
      );
    }
    expect((await h.db.select().from(authRecoveryRequests))[0]?.status).toBe("pending");
    expect(await h.db.select().from(authTwoFactors)).toHaveLength(1);
    expect(await h.db.select().from(authMailOutbox)).toHaveLength(0);
  });
  test("non-sole, inactive, unverified, mismatched-email or invited identities cannot be approved", async () => {
    const input = await setup();
    const [another] = await h.db
      .insert(users)
      .values({ email: "another-admin@example.com", name: "Another", isAdmin: true })
      .returning();
    expect((await recoverAccountAsOperator(h.db, input, signal())).ok).toBe(false);
    await h.db.delete(users).where(eq(users.id, another!.id));
    for (const change of [{ isActive: false }, { invitedAt: new Date() }]) {
      await h.db.update(users).set(change).where(eq(users.id, owner));
      expect((await recoverAccountAsOperator(h.db, input, signal())).ok).toBe(false);
      await h.db.update(users).set({ isActive: true, invitedAt: null }).where(eq(users.id, owner));
    }
    await h.db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, owner));
    expect((await recoverAccountAsOperator(h.db, input, signal())).ok).toBe(false);
    await h.db
      .update(authUsers)
      .set({ emailVerified: true, email: "different@example.com" })
      .where(eq(authUsers.id, owner));
    expect((await recoverAccountAsOperator(h.db, input, signal())).ok).toBe(false);
    expect((await h.db.select().from(authRecoveryRequests))[0]?.status).toBe("pending");
    expect(await h.db.select().from(authTwoFactors)).toHaveLength(1);
    expect(await h.db.select().from(authMailOutbox)).toHaveLength(0);
  });
  test("reviews and completes a pending case atomically once, preserving the owner UUID", async () => {
    const input = await setup();
    const outcomes = await Promise.all([
      recoverAccountAsOperator(h.db, input, signal()),
      recoverAccountAsOperator(h.db, input, signal()),
    ]);
    expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
    expect((await h.db.select().from(authRecoveryRequests))[0]).toMatchObject({
      status: "resolved",
      reviewedBy: owner,
    });
    expect((await h.db.select().from(users))[0]?.id).toBe(owner);
    expect(await h.db.select().from(authTwoFactors)).toHaveLength(0);
    expect((await h.db.select().from(sessions))[0]?.revokedAt).not.toBeNull();
    const messages = await h.db
      .select({ kind: authMailOutbox.kind, recipient: authMailOutbox.recipient })
      .from(authMailOutbox);
    expect(messages).toHaveLength(2);
    expect(messages).toEqual(
      expect.arrayContaining([
        { kind: "password_reset", recipient: "sole-owner@example.com" },
        { kind: "security_change", recipient: "sole-owner@example.com" },
      ]),
    );
    const events = await h.db.select().from(authSecurityEvents);
    expect(events.filter((event) => event.action === "recovery.emergency_review")).toHaveLength(1);
    expect(events.filter((event) => event.action === "recovery.complete")).toHaveLength(1);
  });
  test("mail-queue failure rolls emergency approval, completion and audit back to pending", async () => {
    const input = await setup();
    await h.db.execute(
      sql`ALTER TABLE auth_mail_outbox ADD CONSTRAINT emergency_test_queue_failure CHECK (kind <> 'password_reset')`,
    );
    try {
      await expect(recoverAccountAsOperator(h.db, input, signal())).rejects.toThrow();
      expect((await h.db.select().from(authRecoveryRequests))[0]).toMatchObject({
        status: "pending",
        reviewedBy: null,
      });
      expect(await h.db.select().from(authTwoFactors)).toHaveLength(1);
      expect((await h.db.select().from(sessions))[0]?.revokedAt).toBeNull();
      expect(await h.db.select().from(authSecurityEvents)).toHaveLength(0);
    } finally {
      await h.db.execute(
        sql`ALTER TABLE auth_mail_outbox DROP CONSTRAINT emergency_test_queue_failure`,
      );
    }
  });
});
