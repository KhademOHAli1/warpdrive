import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, test } from "vitest";
import { env } from "@/config/env";
import { ERROR_IDS } from "@/constants/errorIds";
import { authUsers, deals, sessions } from "@/db/schema";
import { seedPipelineWithStages, seedUser } from "@/db/testing/factories";
import { hashSessionCredential } from "@/features/auth/better/sessionToken";
import { createAuthenticatedMcpHandler } from "@/features/mcp/http";
import { hydrateActor } from "@/server/hydrateActor";
import { makeTestDb, type TestDb } from "@/test/db";
import { registerClient } from "./clients";
import { issueSessionAuthCode } from "./consent";
import { exchangeMcpGrant } from "./exchange";
import { sha256Base64Url } from "./pkce";
import { oauthRouter } from "./router";
import { revokeAllForClientUser } from "./tokens";

let h: TestDb;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(async () => {
  await h.close();
});
const signal = () => AbortSignal.timeout(10_000);
const resource = `${env.BASE_URL.replace(/\/$/, "")}/api/mcp`;

test("a consented MCP app reads visible CRM data and loses all existing grants on disconnect", async () => {
  const owner = await seedUser(h.db);
  const other = await seedUser(h.db);
  await h.db.insert(authUsers).values({
    id: owner.id,
    email: owner.email,
    name: owner.name,
    emailVerified: true,
  });
  const sessionCredential = randomBytes(32).toString("base64url");
  const [session] = await h.db
    .insert(sessions)
    .values({
      userId: owner.id,
      tokenHash: hashSessionCredential(sessionCredential),
      authMethod: "password",
      assurance: "password",
      freshAuthenticatedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    .returning();
  expect(session).toBeDefined();
  if (session === undefined) return;
  const headers = new Headers({ cookie: `wd_sid=${sessionCredential}` });
  const redirectUri = "https://mcp-client.example.test/callback";
  const { clientId } = await registerClient(
    h.db,
    { name: "Connected CRM reader", redirectUris: [redirectUri] },
    signal(),
  );
  const verifier = randomUUID().replaceAll("-", "").repeat(2);
  const binding = { clientId, redirectUri, codeChallenge: sha256Base64Url(verifier), resource };
  const consent = await issueSessionAuthCode(h.db, headers, binding, signal());
  expect(consent.ok).toBe(true);
  assert(consent.ok);
  const codeInput = (code: string) => ({
    grant_type: "authorization_code" as const,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    code,
    resource,
  });
  const exchange = await exchangeMcpGrant(h.db, codeInput(consent.value), signal());
  expect(exchange.ok).toBe(true);
  assert(exchange.ok);
  const pendingConsent = await issueSessionAuthCode(h.db, headers, binding, signal());
  expect(pendingConsent.ok).toBe(true);
  assert(pendingConsent.ok);

  const actor = await hydrateActor(h.db, owner.id, signal());
  expect(actor).not.toBeNull();
  if (actor === null) return;
  const caller = oauthRouter.createCaller({
    db: h.db,
    actor,
    session: { userId: owner.id, sessionId: session.id },
  });
  expect((await caller.listConnections()).map((row) => row.clientId)).toEqual([clientId]);

  const pipeline = await seedPipelineWithStages(h.db, ["Open"]);
  const stage = pipeline.stages[0];
  expect(stage).toBeDefined();
  if (stage === undefined) return;
  const [visible, hidden] = await h.db
    .insert(deals)
    .values(
      [owner, other].map((user, index) => ({
        title: `Connected app private deal ${index}`,
        pipelineId: pipeline.pipeline.id,
        stageId: stage.id,
        ownerId: user.id,
        visibilityLevel: "owner" as const,
      })),
    )
    .returning();
  expect(visible).toBeDefined();
  expect(hidden).toBeDefined();
  if (visible === undefined || hidden === undefined) return;

  const handler = createAuthenticatedMcpHandler(h.db, env.BASE_URL);
  const endpoint = new URL(resource);
  const client = new Client(
    { name: "consented-client-journey", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { authorization: `Bearer ${exchange.value.access_token}` } },
        fetch: (url, init) => handler(new Request(url, init)),
      }),
    );
    const read = await client.callTool({ name: "get_deal", arguments: { id: visible.id } });
    expect(read.isError).not.toBe(true);
    expect(JSON.stringify(read.content)).toContain(visible.title);
    const denied = await client.callTool({ name: "get_deal", arguments: { id: hidden.id } });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain(ERROR_IDS.DEAL_NOT_FOUND);

    await revokeAllForClientUser(h.db, clientId, owner.id, signal());
    expect(await caller.listConnections()).toEqual([]);
    await expect(client.listTools()).rejects.toThrow();
    expect(
      await exchangeMcpGrant(
        h.db,
        {
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: exchange.value.refresh_token,
          resource,
        },
        signal(),
      ),
    ).toEqual({ ok: false, error: "invalid_grant" });
    expect(await exchangeMcpGrant(h.db, codeInput(pendingConsent.value), signal())).toEqual({
      ok: false,
      error: "invalid_grant",
    });
  } finally {
    await client.close();
  }
});
