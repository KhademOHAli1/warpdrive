import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { authAccounts, authTwoFactors, authUsers, sessions, users } from "@/db/schema";
import { authMailOutbox, authRecoveryRequests } from "@/db/schema/authManagement";
import { makeTestDb, type TestDb } from "@/test/db";
import { recoverAccountAsOperator } from "./bootstrapOperator";

let h: TestDb;
const administrator = "00000000-0000-4000-8000-0000000000aa";
const target = "00000000-0000-4000-8000-0000000000bb";
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

async function setup(status: "pending" | "approved" = "approved", emergency = false) {
  if (!emergency)
    await h.db.insert(users).values({
      id: administrator,
      email: "reviewer@example.com",
      name: "Reviewer",
      isAdmin: true,
    });
  await h.db
    .insert(users)
    .values({ id: target, email: "verified-owner@example.com", name: "Owner", isAdmin: emergency });
  await h.db.insert(authUsers).values({
    id: target,
    email: "verified-owner@example.com",
    name: "Owner",
    emailVerified: true,
    twoFactorEnabled: true,
  });
  await h.db.insert(authAccounts).values({
    userId: target,
    accountId: target,
    providerId: "credential",
    password: "existing-password-hash",
  });
  await h.db.insert(authTwoFactors).values({
    userId: target,
    secret: "fixture-encrypted-secret",
    backupCodes: "fixture-hashed-codes",
  });
  await h.db.insert(sessions).values({
    userId: target,
    tokenHash: "old-session-digest",
    expiresAt: new Date(Date.now() + 60_000),
  });
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId: target,
      kind: "factor_recovery",
      status,
      reviewedBy: status === "approved" ? (emergency ? target : administrator) : null,
      reviewedAt: status === "approved" ? new Date() : null,
    })
    .returning();
  return request!.id;
}

describe("host execution of approved recovery", () => {
  test("atomically resolves once and queues native reset only to the verified owner", async () => {
    const requestId = await setup();
    expect(
      await recoverAccountAsOperator(h.db, { requestId, operatorConfirmed: true }, signal()),
    ).toMatchObject({ ok: true });
    expect((await h.db.select().from(authRecoveryRequests))[0]?.status).toBe("resolved");
    expect(await h.db.select().from(authTwoFactors)).toHaveLength(0);
    expect((await h.db.select().from(sessions))[0]?.revokedAt).not.toBeNull();
    const messages = await h.db
      .select({
        kind: authMailOutbox.kind,
        recipient: authMailOutbox.recipient,
        status: authMailOutbox.status,
      })
      .from(authMailOutbox);
    expect(messages).toHaveLength(2);
    expect(messages).toEqual(
      expect.arrayContaining([
        { kind: "password_reset", recipient: "verified-owner@example.com", status: "pending" },
        { kind: "security_change", recipient: "verified-owner@example.com", status: "pending" },
      ]),
    );
    expect((await h.db.select().from(authAccounts))[0]?.password).toBe("existing-password-hash");
    expect(
      await recoverAccountAsOperator(h.db, { requestId, operatorConfirmed: true }, signal()),
    ).toMatchObject({ ok: false, error: "not_approved" });
    expect(await h.db.select().from(authMailOutbox)).toHaveLength(2);
  });
  test("does not approve a pending case or act without host confirmation", async () => {
    const requestId = await setup("pending");
    expect(
      await recoverAccountAsOperator(h.db, { requestId, operatorConfirmed: true }, signal()),
    ).toMatchObject({ ok: false, error: "not_approved" });
    await h.db
      .update(authRecoveryRequests)
      .set({ status: "approved", reviewedBy: administrator, reviewedAt: new Date() })
      .where(eq(authRecoveryRequests.id, requestId));
    expect(
      await recoverAccountAsOperator(h.db, { requestId, operatorConfirmed: false }, signal()),
    ).toMatchObject({ ok: false, error: "confirmation_required" });
    expect(await h.db.select().from(authTwoFactors)).toHaveLength(1);
    expect(await h.db.select().from(authMailOutbox)).toHaveLength(0);
  });
  test("a reset-mail queue failure rolls back factor removal and case resolution", async () => {
    const requestId = await setup();
    await h.db.execute(
      sql`ALTER TABLE auth_mail_outbox ADD CONSTRAINT operator_test_reset_failure CHECK (kind <> 'password_reset')`,
    );
    try {
      await expect(
        recoverAccountAsOperator(h.db, { requestId, operatorConfirmed: true }, signal()),
      ).rejects.toThrow();
      expect((await h.db.select().from(authRecoveryRequests))[0]?.status).toBe("approved");
      expect(await h.db.select().from(authTwoFactors)).toHaveLength(1);
      expect((await h.db.select().from(sessions))[0]?.revokedAt).toBeNull();
      expect(await h.db.select().from(authMailOutbox)).toHaveLength(0);
    } finally {
      await h.db.execute(
        sql`ALTER TABLE auth_mail_outbox DROP CONSTRAINT operator_test_reset_failure`,
      );
    }
  });
  test("the sole-administrator pending case requires explicit emergency ownership confirmation", async () => {
    const requestId = await setup("pending", true);
    expect(
      await recoverAccountAsOperator(h.db, { requestId, operatorConfirmed: true }, signal()),
    ).toMatchObject({ ok: false, error: "not_approved" });
    expect(
      await recoverAccountAsOperator(
        h.db,
        {
          requestId,
          operatorConfirmed: true,
          emergencyLastAdministrator: true,
          ownershipConfirmed: true,
        },
        signal(),
      ),
    ).toMatchObject({ ok: true });
    const messages = await h.db
      .select({ kind: authMailOutbox.kind, recipient: authMailOutbox.recipient })
      .from(authMailOutbox);
    expect(messages).toHaveLength(2);
    expect(messages).toEqual(
      expect.arrayContaining([
        { kind: "password_reset", recipient: "verified-owner@example.com" },
        { kind: "security_change", recipient: "verified-owner@example.com" },
      ]),
    );
  });
});
