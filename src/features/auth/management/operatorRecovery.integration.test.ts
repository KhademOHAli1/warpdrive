import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  authAccounts,
  authPasskeys,
  authTwoFactors,
  authUsers,
  emailAccounts,
  oauthAccessTokens,
  oauthClients,
  oauthRefreshTokens,
  sessions,
  users,
} from "@/db/schema";
import {
  authIntegrationRevocations,
  authMailOutbox,
  authRecoveryRequests,
  authSecurityEvents,
} from "@/db/schema/authManagement";
import { encryptToken } from "@/features/email/crypto";
import { makeTestDb, type TestDb } from "@/test/db";
import { completeApprovedRecovery } from "./operatorRecovery";

let h: TestDb;
const adminId = "00000000-0000-4000-8000-0000000000aa";
const userId = "00000000-0000-4000-8000-0000000000bb";
const signal = () => AbortSignal.timeout(10000);
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE users RESTART IDENTITY CASCADE`);
  await h.db.insert(users).values([
    { id: adminId, name: "Admin", email: "admin@example.com", isAdmin: true },
    { id: userId, name: "Member", email: "member@example.com" },
  ]);
  await h.db.insert(authUsers).values([
    { id: adminId, name: "Admin", email: "admin@example.com", emailVerified: true },
    {
      id: userId,
      name: "Member",
      email: "member@example.com",
      emailVerified: true,
      twoFactorEnabled: true,
    },
  ]);
  await h.db
    .insert(authTwoFactors)
    .values({ userId, secret: "test-encrypted-secret", backupCodes: "test-hashed-codes" });
  await h.db.insert(authPasskeys).values({
    userId,
    credentialID: "test-credential",
    publicKey: "test-public-key",
    deviceType: "singleDevice",
    backedUp: false,
  });
  await h.db
    .insert(sessions)
    .values({ userId, tokenHash: "test-session-digest", expiresAt: new Date(Date.now() + 60_000) });
});
test("an unreviewed case or missing explicit operator confirmation cannot reset factors", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({ userId, kind: "factor_recovery" })
    .returning();
  expect(
    (
      await completeApprovedRecovery(
        h.db,
        { requestId: request!.id, operatorConfirmed: false },
        signal(),
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await completeApprovedRecovery(
        h.db,
        { requestId: request!.id, operatorConfirmed: true },
        signal(),
      )
    ).ok,
  ).toBe(false);
  expect(
    await h.db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, userId)),
  ).toHaveLength(1);
});
test("an approved ownership-verified operator recovery resets factors, revokes sessions and is one-use", async () => {
  await h.db
    .insert(oauthClients)
    .values({
      id: "operator-test-client",
      name: "Client",
      redirectUris: ["https://client.example.com/callback"],
    })
    .onConflictDoNothing();
  const expiresAt = new Date(Date.now() + 60_000);
  await h.db
    .insert(oauthAccessTokens)
    .values({ jti: "operator-access", userId, clientId: "operator-test-client", expiresAt });
  await h.db
    .insert(oauthRefreshTokens)
    .values({ tokenHash: "operator-refresh", userId, clientId: "operator-test-client", expiresAt });
  await h.db.insert(emailAccounts).values({
    userId,
    emailAddress: "member@example.com",
    refreshTokenEnc: encryptToken("test-operator-grant"),
  });
  await h.db.insert(authAccounts).values({
    userId,
    accountId: userId,
    providerId: "credential",
    password: "test-existing-password-hash",
    refreshToken: "test-native-encrypted-grant",
  });
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId,
      kind: "factor_recovery",
      status: "approved",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    })
    .returning();
  const outcomes = await Promise.all([
    completeApprovedRecovery(h.db, { requestId: request!.id, operatorConfirmed: true }, signal()),
    completeApprovedRecovery(h.db, { requestId: request!.id, operatorConfirmed: true }, signal()),
  ]);
  expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
  expect(
    await h.db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, userId)),
  ).toHaveLength(0);
  expect(
    await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, userId)),
  ).toHaveLength(0);
  const [authUser] = await h.db.select().from(authUsers).where(eq(authUsers.id, userId));
  const [session] = await h.db.select().from(sessions).where(eq(sessions.userId, userId));
  const [stored] = await h.db
    .select()
    .from(authRecoveryRequests)
    .where(eq(authRecoveryRequests.id, request!.id));
  expect(authUser!.twoFactorEnabled).toBe(false);
  expect(session!.revokedAt).not.toBeNull();
  expect(stored!.status).toBe("resolved");
  const [access] = await h.db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.userId, userId));
  const [refresh] = await h.db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, userId));
  const [mailbox] = await h.db.select().from(emailAccounts).where(eq(emailAccounts.userId, userId));
  const [account] = await h.db.select().from(authAccounts).where(eq(authAccounts.userId, userId));
  expect(access!.revokedAt).not.toBeNull();
  expect(refresh!.revokedAt).not.toBeNull();
  expect(mailbox!.status).toBe("disconnected");
  expect(mailbox!.refreshTokenEnc).toBeNull();
  expect(account!.password).toBe("test-existing-password-hash");
  expect(account!.refreshToken).toBeNull();
  expect(
    await h.db
      .select()
      .from(authIntegrationRevocations)
      .where(eq(authIntegrationRevocations.userId, userId)),
  ).toHaveLength(1);
  expect(
    await h.db.select().from(authMailOutbox).where(eq(authMailOutbox.userId, userId)),
  ).toHaveLength(1);
  expect(
    await h.db
      .select()
      .from(authSecurityEvents)
      .where(eq(authSecurityEvents.action, "recovery.complete")),
  ).toHaveLength(1);
});
test("self-approved recovery is rejected outside the sole-administrator operator emergency", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId: adminId,
      kind: "factor_recovery",
      status: "approved",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    })
    .returning();
  expect(
    (
      await completeApprovedRecovery(
        h.db,
        { requestId: request!.id, operatorConfirmed: true },
        signal(),
      )
    ).ok,
  ).toBe(false);
});
test("a previously approved case cannot be completed after its reviewer loses administrator access", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId,
      kind: "factor_recovery",
      status: "approved",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    })
    .returning();
  await h.db.update(users).set({ isAdmin: false }).where(eq(users.id, adminId));
  expect(
    (
      await completeApprovedRecovery(
        h.db,
        { requestId: request!.id, operatorConfirmed: true },
        signal(),
      )
    ).ok,
  ).toBe(false);
  expect(
    await h.db.select().from(authTwoFactors).where(eq(authTwoFactors.userId, userId)),
  ).toHaveLength(1);
});
test("a reviewed case still requires a verified active owner", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId,
      kind: "factor_recovery",
      status: "approved",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    })
    .returning();
  await h.db.update(authUsers).set({ emailVerified: false }).where(eq(authUsers.id, userId));
  expect(
    (
      await completeApprovedRecovery(
        h.db,
        { requestId: request!.id, operatorConfirmed: true },
        signal(),
      )
    ).ok,
  ).toBe(false);
  expect(
    await h.db.select().from(authPasskeys).where(eq(authPasskeys.userId, userId)),
  ).toHaveLength(1);
});
test("host-operator emergency confirmation permits only the sole established administrator", async () => {
  const [request] = await h.db
    .insert(authRecoveryRequests)
    .values({
      userId: adminId,
      kind: "factor_recovery",
      status: "approved",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    })
    .returning();
  await h.db.update(users).set({ isAdmin: true }).where(eq(users.id, userId));
  expect(
    (
      await completeApprovedRecovery(
        h.db,
        { requestId: request!.id, operatorConfirmed: true, emergencyLastAdministrator: true },
        signal(),
      )
    ).ok,
  ).toBe(false);
  await h.db.update(users).set({ isAdmin: false }).where(eq(users.id, userId));
  expect(
    (
      await completeApprovedRecovery(
        h.db,
        { requestId: request!.id, operatorConfirmed: true, emergencyLastAdministrator: true },
        signal(),
      )
    ).ok,
  ).toBe(true);
});

test("concurrent approved cases for one owner resolve once without a lock cycle", async () => {
  const requests = await h.db
    .insert(authRecoveryRequests)
    .values([
      {
        userId,
        kind: "factor_recovery",
        status: "approved",
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
      {
        userId,
        kind: "factor_recovery",
        status: "approved",
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    ])
    .returning();
  const outcomes = await Promise.all(
    requests.map((request) =>
      completeApprovedRecovery(h.db, { requestId: request.id, operatorConfirmed: true }, signal()),
    ),
  );
  expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
});
