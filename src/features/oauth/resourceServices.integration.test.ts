import assert from "node:assert/strict";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { decodeJwt, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { env } from "@/config/env";
import { OAUTH_JWT_ALGORITHM } from "@/constants/oauth";
import { authenticateMcp } from "@/features/mcp/auth";
import { createAuthenticatedMcpHandler } from "@/features/mcp/http";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createMcpResourceFixtures,
  type McpResourceFixtures,
  mcpResource,
} from "@/test/mcpResourceFixtures";
import { issueAuthCode } from "./authorize";
import { issueSessionAuthCode } from "./consent";
import { exchangeMcpGrant } from "./exchange";
import { issueAccessToken } from "./tokens";

let h: TestDb;
let fixture: McpResourceFixtures;
const originalBaseUrl = env.BASE_URL;
const signal = () => AbortSignal.timeout(10_000);

beforeAll(async () => {
  h = await makeTestDb();
});
beforeEach(async () => {
  fixture = await createMcpResourceFixtures(h);
});
afterEach(async () => {
  env.BASE_URL = originalBaseUrl;
  await fixture.close();
});
afterAll(async () => {
  await h.close();
});

const invalidResources = [
  ["missing", undefined],
  ["empty", ""],
  ["foreign", "https://foreign.example.test/api/mcp"],
  ["repeated", [mcpResource(), mcpResource()]],
] as const;

test.each(invalidResources)(
  "code issue rejects %s resource before any insert",
  async (_name, resource) => {
    const before = await fixture.snapshot();
    expect(
      await issueAuthCode(
        fixture.noAccessDb,
        { ...fixture.codeBinding(), userId: fixture.userId, resource },
        signal(),
      ),
    ).toEqual({ ok: false, error: "invalid_target" });
    expect(await fixture.snapshot()).toEqual(before);
  },
);

test.each(invalidResources)(
  "consent rejects %s resource before session or grant lookup",
  async (_name, resource) => {
    const before = await fixture.snapshot();
    expect(
      await issueSessionAuthCode(
        fixture.noAccessDb,
        fixture.headers(),
        { ...fixture.codeBinding(), resource },
        signal(),
      ),
    ).toEqual({ ok: false, error: "invalid_target" });
    expect(await fixture.snapshot()).toEqual(before);
  },
);

test.each(["code", "refresh"] as const)(
  "%s exchange rejects every invalid target before grant lookup",
  async (grant) => {
    const before = await fixture.snapshot();
    for (const [, resource] of invalidResources) {
      const input = grant === "code" ? fixture.codeGrant() : fixture.refreshGrant();
      expect(await exchangeMcpGrant(fixture.noAccessDb, { ...input, resource }, signal())).toEqual({
        ok: false,
        error: "invalid_target",
      });
      expect(await fixture.snapshot()).toEqual(before);
    }
  },
);

test("the no-access connection is a real role without OAuth table privileges", async () => {
  await expect(
    fixture.noAccessDb.execute("SELECT * FROM oauth_auth_codes LIMIT 1"),
  ).rejects.toThrow();
});

test("a valid grant retains the exact configured issuer, audience and MCP auth resource", async () => {
  env.BASE_URL = `${originalBaseUrl.replace(/\/$/, "")}/`;
  const exchanged = await exchangeMcpGrant(fixture.ownerDb, fixture.codeGrant(), signal());
  assert(exchanged.ok);
  const claims = decodeJwt(exchanged.value.access_token);
  expect(claims.iss).toBe(env.BASE_URL);
  expect(claims.aud).toBe(mcpResource());
  const authenticated = await authenticateMcp(
    fixture.ownerDb,
    `Bearer ${exchanged.value.access_token}`,
    signal(),
  );
  assert(authenticated.ok);
  expect(authenticated.value.authInfo.resource?.toString()).toBe(mcpResource());
});

test.each(["issuer", "audience"] as const)(
  "a signed token with a foreign %s is rejected before lookup",
  async (claim) => {
    const issued = await issueAccessToken(
      fixture.ownerDb,
      { clientId: fixture.clientId, userId: fixture.userId },
      signal(),
    );
    const payload = decodeJwt(issued.token);
    const altered = await new SignJWT({
      ...payload,
      ...(claim === "issuer"
        ? { iss: "https://foreign.example.test" }
        : { aud: "https://foreign.example.test/api/mcp" }),
    })
      .setProtectedHeader({ alg: OAUTH_JWT_ALGORITHM })
      .sign(Buffer.from(env.OAUTH_SIGNING_KEY, "base64"));
    const before = await fixture.snapshot();
    const result = await authenticateMcp(fixture.noAccessDb, `Bearer ${altered}`, signal());
    expect(result.ok).toBe(false);
    assert(!result.ok);
    expect(result.error.id).toBe("E_OAUTH_005");
    expect(await fixture.snapshot()).toEqual(before);

    const validHandler = createAuthenticatedMcpHandler(fixture.ownerDb, env.BASE_URL);
    const wire: { acceptedRequest?: Request } = {};
    const client = new Client(
      { name: "resource-wire-control", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(mcpResource()), {
          requestInit: { headers: { authorization: `Bearer ${issued.token}` } },
          fetch: (url, init) => {
            const request = new Request(url, init);
            wire.acceptedRequest = request.clone();
            return validHandler(request);
          },
        }),
      );
      expect((await client.listTools()).tools.length).toBeGreaterThan(0);
      assert(wire.acceptedRequest !== undefined);
      const headers = new Headers(wire.acceptedRequest.headers);
      headers.set("authorization", `Bearer ${altered}`);
      const beforeWire = await fixture.snapshot();
      const denied = await createAuthenticatedMcpHandler(
        fixture.noAccessDb,
        env.BASE_URL,
      )(new Request(wire.acceptedRequest, { headers }));
      expect(denied.status).toBe(401);
      expect(denied.headers.get("www-authenticate")).toContain("resource_metadata=");
      expect(await fixture.snapshot()).toEqual(beforeWire);
    } finally {
      await client.close();
    }
  },
);

test.each([
  "http://crm.example.test",
  "https://crm.example.test?foreign=1",
  "https://user:secret@crm.example.test",
])("invalid profile %j blocks public services and bearer lookup", async (baseUrl) => {
  env.BASE_URL = baseUrl;
  const issued = await issueAccessToken(
    fixture.ownerDb,
    { clientId: fixture.clientId, userId: fixture.userId },
    signal(),
  );
  const before = await fixture.snapshot();
  expect(await exchangeMcpGrant(fixture.noAccessDb, fixture.codeGrant(), signal())).toEqual({
    ok: false,
    error: "invalid_target",
  });
  const authenticated = await authenticateMcp(
    fixture.noAccessDb,
    `Bearer ${issued.token}`,
    signal(),
  );
  expect(authenticated.ok).toBe(false);
  assert(!authenticated.ok);
  expect(authenticated.error.id).toBe("E_OAUTH_007");
  expect(await fixture.snapshot()).toEqual(before);
});

test.each([
  "http://crm.example.test",
  "https://crm.example.test?foreign=1",
  "https://user:secret@crm.example.test",
  "https://foreign.example.test",
])("MCP handler refuses invalid or mismatched factory profile %j", async (baseUrl) => {
  const before = await fixture.snapshot();
  const handler = createAuthenticatedMcpHandler(fixture.noAccessDb, baseUrl);
  const response = await handler(new Request(`${originalBaseUrl.replace(/\/$/, "")}/api/mcp`));
  expect(response.status).toBe(404);
  expect(response.headers.get("www-authenticate")).toBeNull();
  expect(await response.text()).not.toContain(baseUrl);
  expect(await fixture.snapshot()).toEqual(before);
});
