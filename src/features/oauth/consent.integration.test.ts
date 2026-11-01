import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { env } from "@/config/env";
import { authPolicies, authUsers, oauthClients, sessions, users } from "@/db/schema";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { lockMcpGrants, revokeMcpGrants } from "@/features/auth/management/mcpGrants";
import { makeTestDb, type TestDb } from "@/test/db";
import { issueSessionAuthCode } from "./consent";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(10000);
const resource = `${env.BASE_URL.replace(/\/$/, "")}/api/mcp`;
async function setup(stale = false) {
  const id = randomUUID();
  const clientId = randomUUID();
  const raw = randomBytes(32).toString("base64url");
  await h.db.insert(users).values({ id, email: `${id}@example.com`, name: "Consent owner" });
  await h.db
    .insert(authUsers)
    .values({ id, email: `${id}@example.com`, name: "Consent owner", emailVerified: true });
  await h.db.insert(sessions).values({
    userId: id,
    tokenHash: hashSessionCredential(raw),
    authMethod: "password",
    assurance: "password",
    freshAuthenticatedAt: new Date(Date.now() - (stale ? 600000 : 0)),
    expiresAt: new Date(Date.now() + 3600000),
  });
  await h.db.insert(oauthClients).values({
    id: clientId,
    name: "Consent client",
    redirectUris: ["https://client.example.com/callback"],
  });
  return {
    id,
    headers: new Headers({ cookie: `wd_sid=${raw}` }),
    binding: {
      clientId,
      redirectUri: "https://client.example.com/callback",
      codeChallenge: "a".repeat(43),
      resource,
    },
  };
}
test("MCP consent requires fresh authentication before issuing a credential", async () => {
  const current = await setup();
  expect((await issueSessionAuthCode(h.db, current.headers, current.binding, signal())).ok).toBe(
    true,
  );
  const stale = await setup(true);
  expect(await issueSessionAuthCode(h.db, stale.headers, stale.binding, signal())).toEqual({
    ok: false,
    error: "authentication_required",
  });
});
test("consent rechecks assurance after an in-flight workspace policy change", async () => {
  const current = await setup();
  let ready = () => {};
  let release = () => {};
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const policy = h.db.transaction(async (tx) => {
    await lockMcpGrants(tx, signal());
    ready();
    await gate;
    await tx
      .insert(authPolicies)
      .values({ id: true, requireMfaForAll: true })
      .onConflictDoUpdate({ target: authPolicies.id, set: { requireMfaForAll: true } });
    await revokeMcpGrants(tx, null, signal());
  });
  await locked;
  let completed = false;
  const consent = issueSessionAuthCode(h.db, current.headers, current.binding, signal()).finally(
    () => {
      completed = true;
    },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(completed).toBe(false);
  } finally {
    release();
    await policy;
  }
  expect(await consent).toEqual({ ok: false, error: "authentication_required" });
});
