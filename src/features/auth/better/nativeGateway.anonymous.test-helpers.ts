import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect } from "vitest";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import {
  authAccounts,
  authMailOutbox,
  authUsers,
  oauthAccessTokens,
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
  users,
} from "@/db/schema";
import { decryptToken } from "@/features/email/crypto";
import type { TestDb } from "@/test/db";
import { createBetterAuth } from "./auth";

export async function anonymousResetFixture(h: TestDb) {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  await h.db.insert(users).values({ id: userId, email, name: "Anonymous reset" });
  await h.db
    .insert(authUsers)
    .values({ id: userId, email, name: "Anonymous reset", emailVerified: true });
  const auth = createBetterAuth(h.db);
  const password = await (await auth.$context).password.hash(
    "Initial-secure-qualification-password",
  );
  const [account] = await h.db
    .insert(authAccounts)
    .values({ userId, accountId: userId, providerId: "credential", password })
    .returning();
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: `${env.BASE_URL}/auth/reset-password` },
    headers: new Headers({ origin: new URL(env.BASE_URL).origin }),
  });
  const [mail] = await h.db
    .select()
    .from(authMailOutbox)
    .where(and(eq(authMailOutbox.userId, userId), eq(authMailOutbox.kind, "password_reset")));
  if (account === undefined || mail === undefined)
    throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "Reset fixture records unavailable");
  const decrypted = decryptToken(mail.payloadEnc);
  expect(decrypted.ok).toBe(true);
  if (!decrypted.ok)
    throw new AppError(ERROR_IDS.AUTH_POLICY_DENIED, "Reset fixture message unavailable");
  const payload = JSON.parse(decrypted.value) as { url: string };
  const token = new URL(payload.url).pathname.split("/").at(-1);
  const clientId = randomUUID();
  const expiresAt = new Date(Date.now() + 60_000);
  await h.db.insert(oauthClients).values({
    id: clientId,
    name: "Old grant client",
    redirectUris: ["https://client.example.com/callback"],
  });
  await h.db.insert(oauthAccessTokens).values({ jti: randomUUID(), userId, clientId, expiresAt });
  await h.db
    .insert(oauthRefreshTokens)
    .values({ tokenHash: randomUUID(), userId, clientId, expiresAt });
  await h.db.insert(oauthAuthCodes).values({
    codeHash: randomUUID(),
    userId,
    clientId,
    redirectUri: "https://client.example.com/callback",
    codeChallenge: "fixture-challenge",
    expiresAt,
  });
  return {
    userId,
    accountId: account.id,
    auth,
    password,
    request: new Request(`${env.BASE_URL}/api/auth/reset-password`, {
      method: "POST",
      headers: { origin: new URL(env.BASE_URL).origin, "content-type": "application/json" },
      body: JSON.stringify({ token, newPassword: "New-secure-qualification-password" }),
    }),
  };
}

export async function grantState(h: TestDb, userId: string) {
  const [access, refresh, codes] = await Promise.all([
    h.db.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.userId, userId)),
    h.db.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.userId, userId)),
    h.db.select().from(oauthAuthCodes).where(eq(oauthAuthCodes.userId, userId)),
  ]);
  return {
    access: access.map((row) => row.revokedAt !== null),
    refresh: refresh.map((row) => row.revokedAt !== null),
    codes: codes.map((row) => row.consumedAt !== null),
  };
}

export async function waitForNativeLock(
  h: TestDb,
  queryPattern: string,
  signal: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + 5000;
  while (!signal.aborted && Date.now() < deadline) {
    const result = await h.pool.query<{ waiting: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE $1) AS waiting",
      [queryPattern],
    );
    if (result.rows[0]?.waiting === true) return true;
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  return false;
}
