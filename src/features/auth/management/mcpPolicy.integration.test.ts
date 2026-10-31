import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import {
  oauthAccessTokens,
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
  users,
} from "@/db/schema";
import { setUserAdmin } from "@/features/identity/users.service";
import type { PermSetUser } from "@/features/permissions/effective";
import { makeTestDb, type TestDb } from "@/test/db";
import { DEFAULT_AUTH_POLICY } from "./domain";
import { updateAuthPolicy } from "./policy";

let h: TestDb;
const admin: PermSetUser = {
  id: "00000000-0000-4000-8000-0000000000aa",
  type: "admin",
  isActive: true,
  flags: new Set(),
  groupIds: new Set(),
};
const memberId = "00000000-0000-4000-8000-0000000000bb";
const signal = () => AbortSignal.timeout(10000);
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.db.execute(sql`TRUNCATE users, oauth_clients RESTART IDENTITY CASCADE`);
  await h.db.insert(users).values([
    { id: admin.id, name: "Admin", email: "admin@example.com", isAdmin: true },
    { id: memberId, name: "Member", email: "member@example.com" },
  ]);
  await h.db.insert(oauthClients).values({
    id: "mcp-policy-test",
    name: "Test client",
    redirectUris: ["https://client.example.com/callback"],
  });
  for (const userId of [admin.id, memberId]) {
    const expiresAt = new Date(Date.now() + 60_000);
    await h.db
      .insert(oauthAccessTokens)
      .values({ jti: `access-${userId}`, userId, clientId: "mcp-policy-test", expiresAt });
    await h.db
      .insert(oauthRefreshTokens)
      .values({ tokenHash: `refresh-${userId}`, userId, clientId: "mcp-policy-test", expiresAt });
    await h.db.insert(oauthAuthCodes).values({
      codeHash: `code-${userId}`,
      userId,
      clientId: "mcp-policy-test",
      expiresAt,
      redirectUri: "https://client.example.com/callback",
      codeChallenge: "test-challenge",
    });
  }
});
async function grantState(userId: string) {
  const [access] = await h.db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.userId, userId));
  const [refresh] = await h.db
    .select()
    .from(oauthRefreshTokens)
    .where(eq(oauthRefreshTokens.userId, userId));
  const [code] = await h.db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.userId, userId));
  return [access!.revokedAt, refresh!.revokedAt, code!.consumedAt];
}
test("tightening MFA policy revokes existing MCP grants and unexchanged consent codes atomically", async () => {
  expect(
    (
      await updateAuthPolicy(
        h.db,
        admin,
        { ...DEFAULT_AUTH_POLICY, requireMfaForAll: true },
        signal(),
      )
    ).ok,
  ).toBe(true);
  expect((await grantState(memberId)).every((value) => value !== null)).toBe(true);
  expect((await grantState(admin.id)).every((value) => value !== null)).toBe(true);
});
test("changing only timeout limits does not revoke existing delegated grants", async () => {
  expect(
    (await updateAuthPolicy(h.db, admin, { ...DEFAULT_AUTH_POLICY, idleMinutes: 45 }, signal())).ok,
  ).toBe(true);
  expect(await grantState(memberId)).toEqual([null, null, null]);
});
test("administrator promotion invalidates that person's earlier grants while retaining other users' grants", async () => {
  expect((await setUserAdmin(h.db, admin, { userId: memberId, isAdmin: true }, signal())).ok).toBe(
    true,
  );
  expect((await grantState(memberId)).every((value) => value !== null)).toBe(true);
  expect(await grantState(admin.id)).toEqual([null, null, null]);
});
