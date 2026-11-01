import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  oauthAccessTokens,
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
  users,
} from "@/db/schema";
import { lockMcpGrants } from "@/features/auth/management/mcpGrants";
import { makeTestDb, type TestDb } from "@/test/db";
import { issueAuthCode } from "./authorize";
import { exchangeMcpGrant } from "./exchange";
import { sha256Base64Url } from "./pkce";
import {
  issueAccessToken,
  issueRefreshToken,
  revokeAllForClientUser,
  verifyAccessToken,
} from "./tokens";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(10000);
const redirectUri = "https://client.example.com/callback";
const verifier = "a".repeat(64);

async function newUser() {
  const id = randomUUID();
  await h.db.insert(users).values({ id, email: `${id}@example.com`, name: "Grant owner" });
  return id;
}

async function newClient() {
  const id = randomUUID();
  await h.db.insert(oauthClients).values({ id, name: "Grant client", redirectUris: [redirectUri] });
  return id;
}

async function grants(userId: string, clientId: string) {
  const owner = { userId, clientId };
  const access = await issueAccessToken(h.db, owner, signal());
  const refresh = await issueRefreshToken(h.db, owner, signal());
  const code = await issueAuthCode(
    h.db,
    { ...owner, redirectUri, codeChallenge: sha256Base64Url(verifier) },
    signal(),
  );
  return { ...owner, access, refresh, code };
}

type Grants = Awaited<ReturnType<typeof grants>>;

function refreshInput(grant: Grants) {
  return {
    grant_type: "refresh_token" as const,
    client_id: grant.clientId,
    refresh_token: grant.refresh,
  };
}

async function expectUsable(grant: Grants, usable: boolean) {
  expect((await verifyAccessToken(h.db, grant.access.token, signal())).ok).toBe(usable);
  expect((await exchangeMcpGrant(h.db, refreshInput(grant), signal())).ok).toBe(usable);
  expect(
    (
      await exchangeMcpGrant(
        h.db,
        {
          grant_type: "authorization_code",
          client_id: grant.clientId,
          code: grant.code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        },
        signal(),
      )
    ).ok,
  ).toBe(usable);
}

test("revoking one app denies access, refresh and pending codes while preserving other clients and users", async () => {
  const userId = await newUser();
  const clientId = await newClient();
  const revoked = await grants(userId, clientId);
  const otherClient = await grants(userId, await newClient());
  const otherUser = await grants(await newUser(), clientId);

  await revokeAllForClientUser(h.db, clientId, userId, signal());

  await expectUsable(otherClient, true);
  await expectUsable(otherUser, true);
  await expectUsable(revoked, false);
});

test("repeated client revocation preserves existing revocation and consumption timestamps", async () => {
  const original = await grants(await newUser(), await newClient());
  const revokedAt = new Date("2000-01-01T00:00:00.000Z");
  await h.db
    .update(oauthAccessTokens)
    .set({ revokedAt })
    .where(eq(oauthAccessTokens.jti, original.access.jti));
  await h.db
    .update(oauthRefreshTokens)
    .set({ revokedAt })
    .where(eq(oauthRefreshTokens.tokenHash, sha256Base64Url(original.refresh)));
  await h.db
    .update(oauthAuthCodes)
    .set({ consumedAt: revokedAt })
    .where(eq(oauthAuthCodes.codeHash, sha256Base64Url(original.code)));

  await revokeAllForClientUser(h.db, original.clientId, original.userId, signal());

  expect(
    await h.db
      .select({ revokedAt: oauthAccessTokens.revokedAt })
      .from(oauthAccessTokens)
      .where(eq(oauthAccessTokens.jti, original.access.jti)),
  ).toEqual([{ revokedAt }]);
  expect(
    await h.db
      .select({ revokedAt: oauthRefreshTokens.revokedAt })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.tokenHash, sha256Base64Url(original.refresh))),
  ).toEqual([{ revokedAt }]);
  expect(
    await h.db
      .select({ consumedAt: oauthAuthCodes.consumedAt })
      .from(oauthAuthCodes)
      .where(eq(oauthAuthCodes.codeHash, sha256Base64Url(original.code))),
  ).toEqual([{ consumedAt: revokedAt }]);
});

test("client revocation waits for an in-flight exchange and revokes its replacement grants", async () => {
  const original = await grants(await newUser(), await newClient());
  let release = () => {};
  let ready = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const minted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const inFlight = h.db.transaction(async (tx) => {
    await lockMcpGrants(tx, signal());
    const replacement = await exchangeMcpGrant(tx, refreshInput(original), signal());
    ready();
    await gate;
    return replacement;
  });
  await Promise.race([minted, inFlight]);
  const revocation = revokeAllForClientUser(h.db, original.clientId, original.userId, signal());
  try {
    let waiting = false;
    const deadline = Date.now() + 5000;
    while (!waiting && Date.now() < deadline) {
      const result = await h.pool.query<{ waiting: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM pg_locks AS locks
          JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
          WHERE activity.datname = current_database()
            AND locks.locktype = 'advisory'
            AND locks.classid = hashtext('warpdrive-auth')::oid
            AND locks.objid = hashtext('mcp-grants')::oid
            AND locks.objsubid = 2
            AND NOT locks.granted
        ) AS waiting`,
      );
      waiting = result.rows[0]?.waiting === true;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
  } finally {
    release();
    await inFlight;
    await revocation;
  }
  const replacement = await inFlight;
  expect(replacement.ok).toBe(true);
  if (!replacement.ok) return;
  expect((await verifyAccessToken(h.db, replacement.value.access_token, signal())).ok).toBe(false);
  expect(
    await exchangeMcpGrant(
      h.db,
      {
        grant_type: "refresh_token",
        client_id: original.clientId,
        refresh_token: replacement.value.refresh_token,
      },
      signal(),
    ),
  ).toEqual({ ok: false, error: "invalid_grant" });
});

test("client revocation rolls back every credential store when the final authorization-code update fails", async () => {
  const original = await grants(await newUser(), await newClient());
  await h.db.execute(
    sql`CREATE FUNCTION reject_test_auth_code_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test authorization-code revocation failure'; END; $$`,
  );
  try {
    await h.db.execute(
      sql`CREATE TRIGGER reject_test_auth_code_revoke BEFORE UPDATE ON oauth_auth_codes FOR EACH ROW EXECUTE FUNCTION reject_test_auth_code_revoke()`,
    );
    await expect(
      revokeAllForClientUser(h.db, original.clientId, original.userId, signal()),
    ).rejects.toThrow();
    expect(
      await h.db
        .select({ revokedAt: oauthAccessTokens.revokedAt })
        .from(oauthAccessTokens)
        .where(eq(oauthAccessTokens.jti, original.access.jti)),
    ).toEqual([{ revokedAt: null }]);
    expect(
      await h.db
        .select({ revokedAt: oauthRefreshTokens.revokedAt })
        .from(oauthRefreshTokens)
        .where(eq(oauthRefreshTokens.tokenHash, sha256Base64Url(original.refresh))),
    ).toEqual([{ revokedAt: null }]);
    expect(
      await h.db
        .select({ consumedAt: oauthAuthCodes.consumedAt })
        .from(oauthAuthCodes)
        .where(eq(oauthAuthCodes.codeHash, sha256Base64Url(original.code))),
    ).toEqual([{ consumedAt: null }]);
  } finally {
    await h.db.execute(
      sql`DROP TRIGGER IF EXISTS reject_test_auth_code_revoke ON oauth_auth_codes`,
    );
    await h.db.execute(sql`DROP FUNCTION IF EXISTS reject_test_auth_code_revoke()`);
  }
  await expectUsable(original, true);
});
