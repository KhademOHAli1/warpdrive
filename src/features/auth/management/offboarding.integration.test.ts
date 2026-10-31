import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  emailAccounts,
  oauthAccessTokens,
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
  sessions,
  users,
} from "@/db/schema";
import { authIntegrationRevocations } from "@/db/schema/authManagement";
import { encryptToken } from "@/features/email/crypto";
import { setUserActive } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";

let h: TestDb;
const signal = () => AbortSignal.timeout(10000);
const admin: PermSetUser = {
  id: "00000000-0000-0000-0000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const targetId = "00000000-0000-0000-0000-0000000000bb";
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE users, oauth_clients RESTART IDENTITY CASCADE`);
  await h.db.insert(users).values([
    { id: admin.id, email: "admin@example.com", name: "Admin", isAdmin: true },
    { id: targetId, email: "target@example.com", name: "Target" },
  ]);
  await h.db.insert(oauthClients).values({
    id: "client",
    name: "Client",
    redirectUris: ["https://client.example.com/callback"],
  });
  const expiresAt = new Date(Date.now() + 60_000);
  await h.db.insert(sessions).values({ userId: targetId, tokenHash: "session-hash", expiresAt });
  await h.db
    .insert(oauthAccessTokens)
    .values({ jti: "access", userId: targetId, clientId: "client", expiresAt });
  await h.db
    .insert(oauthRefreshTokens)
    .values({ tokenHash: "refresh-hash", userId: targetId, clientId: "client", expiresAt });
  await h.db.insert(oauthAuthCodes).values({
    codeHash: "code-hash",
    userId: targetId,
    clientId: "client",
    redirectUri: "https://client.example.com/callback",
    codeChallenge: "challenge",
    expiresAt,
  });
  await h.db.insert(emailAccounts).values({
    userId: targetId,
    emailAddress: "target@example.com",
    refreshTokenEnc: encryptToken("test-mailbox-refresh-token"),
  });
});
test("offboarding permanently revokes all local grants, queues external revocation and does not revive them on reactivation", async () => {
  expect(
    (await setUserActive(h.db, admin, { userId: targetId, isActive: false }, signal())).ok,
  ).toBe(true);
  const [session] = await h.db.select().from(sessions).where(eq(sessions.userId, targetId));
  const [access] = await h.db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.userId, targetId));
  const [refresh] = await h.db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, targetId));
  const [code] = await h.db
    .select()
    .from(oauthAuthCodes)
    .where(eq(oauthAuthCodes.userId, targetId));
  const [account] = await h.db
    .select()
    .from(emailAccounts)
    .where(eq(emailAccounts.userId, targetId));
  expect(session!.revokedAt).not.toBeNull();
  expect(access!.revokedAt).not.toBeNull();
  expect(refresh!.revokedAt).not.toBeNull();
  expect(code!.consumedAt).not.toBeNull();
  expect(account!.status).toBe("disconnected");
  expect(account!.refreshTokenEnc).toBeNull();
  expect(
    await h.db
      .select()
      .from(authIntegrationRevocations)
      .where(eq(authIntegrationRevocations.userId, targetId)),
  ).toHaveLength(1);
  expect(
    (await setUserActive(h.db, admin, { userId: targetId, isActive: true }, signal())).ok,
  ).toBe(true);
  const [stillRevoked] = await h.db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, targetId));
  expect(stillRevoked!.revokedAt).not.toBeNull();
});
