import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env";
import * as schema from "@/db/schema";
import { seedUser } from "@/db/testing/factories";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { CSRF_COOKIE, mintCsrfToken } from "@/features/auth/csrf";
import { SESSION_COOKIE } from "@/features/auth/session";
import { sha256Base64Url } from "@/features/oauth/pkce";
import type { TestDb } from "./db";

export function mcpResource(): string {
  return `${env.BASE_URL.replace(/\/$/, "")}/api/mcp`;
}

export async function createMcpResourceFixtures(h: TestDb) {
  const owner = await seedUser(h.db);
  await h.db.insert(schema.authUsers).values({
    id: owner.id,
    email: owner.email,
    name: owner.name,
    emailVerified: true,
  });
  const sessionCredential = randomBytes(32).toString("base64url");
  await h.db.insert(schema.sessions).values({
    userId: owner.id,
    tokenHash: hashSessionCredential(sessionCredential),
    authMethod: "password",
    assurance: "password",
    freshAuthenticatedAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const clientId = randomUUID();
  const redirectUri = "https://resource-client.example.test/callback";
  await h.db.insert(schema.oauthClients).values({
    id: clientId,
    name: "Native MCP resource fixture",
    redirectUris: [redirectUri],
  });
  const verifier = randomBytes(48).toString("base64url");
  const code = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(32).toString("base64url");
  await h.db.insert(schema.oauthAuthCodes).values({
    codeHash: sha256Base64Url(code),
    clientId,
    userId: owner.id,
    redirectUri,
    codeChallenge: sha256Base64Url(verifier),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await h.db.insert(schema.oauthRefreshTokens).values({
    tokenHash: sha256Base64Url(refreshToken),
    clientId,
    userId: owner.id,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const csrfToken = mintCsrfToken();
  const role = `mcp_resource_${randomUUID().replaceAll("-", "")}`;
  const password = randomBytes(32).toString("hex");
  await h.pool.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`,
  );
  const roleUrl = new URL(h.url);
  roleUrl.username = role;
  roleUrl.password = password;
  const noAccessPool = new Pool({
    connectionString: roleUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 1_000,
    statement_timeout: 5_000,
  });
  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      await noAccessPool.end();
      await h.pool.query(`DROP OWNED BY "${role}"`);
      await h.pool.query(`DROP ROLE "${role}"`);
    })();
    return closing;
  };
  try {
    const privileges = await noAccessPool.query<{ allowed: boolean }>(
      `SELECT bool_or(has_table_privilege(current_user, name, 'SELECT,INSERT,UPDATE,DELETE')) AS allowed
       FROM (VALUES ('oauth_clients'), ('oauth_auth_codes'), ('oauth_access_tokens'),
         ('oauth_refresh_tokens'), ('sessions'), ('users'), ('auth_users')) AS tables(name)`,
    );
    assert.equal(privileges.rows[0]?.allowed, false);
  } catch (error) {
    await close();
    throw error;
  }

  return {
    ownerDb: h.db,
    noAccessDb: drizzle(noAccessPool, { schema }),
    userId: owner.id,
    clientId,
    redirectUri,
    verifier,
    code,
    refreshToken,
    sessionCredential,
    csrfToken,
    headers() {
      const base = new URL(env.BASE_URL);
      return new Headers({
        cookie: `${SESSION_COOKIE}=${sessionCredential}; ${CSRF_COOKIE}=${csrfToken}`,
        origin: base.origin,
        host: base.host,
        "sec-fetch-site": "same-origin",
      });
    },
    authorizationParams(resourceValues: string[] = [mcpResource()]) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: sha256Base64Url(verifier),
        code_challenge_method: "S256",
        state: "native-resource-state",
      });
      for (const resource of resourceValues) params.append("resource", resource);
      return params;
    },
    codeGrant(resource: unknown = mcpResource()) {
      return {
        grant_type: "authorization_code" as const,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        code,
        resource,
      };
    },
    refreshGrant(resource: unknown = mcpResource()) {
      return {
        grant_type: "refresh_token" as const,
        client_id: clientId,
        refresh_token: refreshToken,
        resource,
      };
    },
    codeBinding(resource: unknown = mcpResource()) {
      return {
        userId: owner.id,
        clientId,
        redirectUri,
        codeChallenge: sha256Base64Url(verifier),
        resource,
      };
    },
    async snapshot() {
      const [codes, access, refresh] = await Promise.all([
        h.db.select().from(schema.oauthAuthCodes).orderBy(schema.oauthAuthCodes.codeHash),
        h.db.select().from(schema.oauthAccessTokens).orderBy(schema.oauthAccessTokens.jti),
        h.db.select().from(schema.oauthRefreshTokens).orderBy(schema.oauthRefreshTokens.tokenHash),
      ]);
      return { codes, access, refresh };
    },
    close,
  };
}

export type McpResourceFixtures = Awaited<ReturnType<typeof createMcpResourceFixtures>>;
