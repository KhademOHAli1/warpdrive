import { randomUUID } from "node:crypto";
import { eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import { oauthAccessTokens, oauthClients, oauthRefreshTokens, users } from "@/db/schema";
import { lockMcpGrants, revokeMcpGrants } from "@/features/auth/management/mcpGrants";
import { makeTestDb, type TestDb } from "@/test/db";
import { issueAuthCode } from "./authorize";
import { exchangeMcpGrant } from "./exchange";
import { sha256Base64Url } from "./pkce";
import { issueRefreshToken } from "./tokens";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(10000);

test.each(["refresh_token", "authorization_code"] as const)(
  "%s exchange waits for policy revocation and cannot mint replacement grants afterwards",
  async (grant_type) => {
    const id = randomUUID();
    const clientId = randomUUID();
    await h.db.insert(users).values({ id, email: `${id}@example.com`, name: "Grant owner" });
    await h.db.insert(oauthClients).values({
      id: clientId,
      name: "Grant client",
      redirectUris: ["https://client.example.com/callback"],
    });
    const verifier = "a".repeat(64);
    const input =
      grant_type === "refresh_token"
        ? {
            grant_type,
            client_id: clientId,
            refresh_token: await issueRefreshToken(h.db, { userId: id, clientId }, signal()),
          }
        : {
            grant_type,
            client_id: clientId,
            code_verifier: verifier,
            redirect_uri: "https://client.example.com/callback",
            code: await issueAuthCode(
              h.db,
              {
                userId: id,
                clientId,
                redirectUri: "https://client.example.com/callback",
                codeChallenge: sha256Base64Url(verifier),
              },
              signal(),
            ),
          };
    let release = () => {};
    let started = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      started = resolve;
    });
    const sweep = h.db.transaction(async (tx) => {
      await lockMcpGrants(tx, signal());
      started();
      await gate;
      await revokeMcpGrants(tx, id, signal());
    });
    await locked;
    let completed = false;
    const exchange = exchangeMcpGrant(h.db, input, signal()).finally(() => {
      completed = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(completed).toBe(false);
    } finally {
      release();
      await sweep;
    }
    expect(await exchange).toEqual({ ok: false, error: "invalid_grant" });
    expect(
      await h.db.select().from(oauthAccessTokens).where(isNull(oauthAccessTokens.revokedAt)),
    ).toHaveLength(0);
    expect(
      await h.db.select().from(oauthRefreshTokens).where(isNull(oauthRefreshTokens.revokedAt)),
    ).toHaveLength(0);
  },
);

test("valid grants exchange once and a suspended owner cannot rotate them", async () => {
  const id = randomUUID();
  const clientId = randomUUID();
  await h.db.insert(users).values({ id, email: `${id}@example.com`, name: "Active owner" });
  await h.db.insert(oauthClients).values({ id: clientId, name: "Client", redirectUris: [] });
  const refresh = await issueRefreshToken(h.db, { userId: id, clientId }, signal());
  const first = await exchangeMcpGrant(
    h.db,
    { grant_type: "refresh_token", client_id: clientId, refresh_token: refresh },
    signal(),
  );
  expect(first.ok).toBe(true);
  await h.db.update(users).set({ isActive: false }).where(eq(users.id, id));
  if (!first.ok) return;
  expect(
    await exchangeMcpGrant(
      h.db,
      {
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: first.value.refresh_token,
      },
      signal(),
    ),
  ).toEqual({ ok: false, error: "invalid_grant" });
});
