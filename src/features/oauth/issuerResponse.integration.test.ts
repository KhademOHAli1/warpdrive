import assert from "node:assert/strict";
import { validateAuthorizationResponseIssuer } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { decodeJwt } from "jose";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import { env } from "@/config/env";
import { oauthClients } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createMcpResourceFixtures,
  type McpResourceFixtures,
  mcpResource,
} from "@/test/mcpResourceFixtures";
import { createAuthorizationHandlers } from "./authorizationHttp";
import { exchangeMcpGrant } from "./exchange";
import { buildAuthServerMetadata } from "./metadata";

let h: TestDb | undefined;
let fixtures: McpResourceFixtures | undefined;
const originalBaseUrl = env.BASE_URL;
beforeEach(async () => {
  h = await makeTestDb();
  fixtures = await createMcpResourceFixtures(h);
});
afterEach(async () => {
  env.BASE_URL = originalBaseUrl;
  try {
    await fixtures?.close();
  } finally {
    await h?.close();
    fixtures = undefined;
    h = undefined;
  }
});

const issuers = [
  "https://crm.example.test",
  "https://crm.example.test/",
  "HTTPS://CRM.EXAMPLE.TEST/",
];
const decisions = ["approve", "deny"] as const;
const outerIssuer = "https://outer-foreign.example.test";

test.each(issuers.flatMap((issuer) => decisions.map((decision) => ({ issuer, decision }))))(
  "$decision authorization response identifies literal issuer $issuer exactly once",
  async ({ issuer, decision }) => {
    assert(fixtures !== undefined);
    const f = fixtures;
    const previousBaseUrl = env.BASE_URL;
    env.BASE_URL = issuer;
    try {
      const callback = new URL(f.redirectUri);
      callback.searchParams.append("iss", "https://callback-foreign-one.example.test");
      callback.searchParams.append("iss", "https://callback-foreign-two.example.test/");
      callback.searchParams.set("keep", "1");
      const registeredRedirectUri = callback.toString();
      await f.ownerDb
        .update(oauthClients)
        .set({ redirectUris: [registeredRedirectUri] })
        .where(eq(oauthClients.id, f.clientId));

      const params = f.authorizationParams();
      params.set("redirect_uri", registeredRedirectUri);
      params.set("csrf_token", f.csrfToken);
      params.set("state", "issuer-response-state");
      params.set("iss", outerIssuer);
      const authorizeUrl = new URL("/oauth/authorize", env.BASE_URL);
      authorizeUrl.search = params.toString();
      const headers = f.headers();
      headers.set("content-type", "application/x-www-form-urlencoded");
      const before = await f.snapshot();
      const response = await createAuthorizationHandlers(f.ownerDb).POST(
        new NextRequest(authorizeUrl, {
          method: "POST",
          headers,
          body: new URLSearchParams({ decision }).toString(),
        }),
      );
      const after = await f.snapshot();
      if (decision === "deny") {
        expect(after).toEqual(before);
      } else {
        expect(after.codes).toHaveLength(before.codes.length + 1);
        expect(after.access).toEqual(before.access);
        expect(after.refresh).toEqual(before.refresh);
      }
      expect(response.status).toBe(302);
      const location = response.headers.get("location");
      assert(location !== null);
      const redirect = new URL(location);
      expect(redirect.origin).toBe(callback.origin);
      expect(redirect.pathname).toBe(callback.pathname);
      expect(redirect.searchParams.getAll("iss")).toEqual([env.BASE_URL]);
      validateAuthorizationResponseIssuer({
        iss: redirect.searchParams.get("iss") ?? undefined,
        expectedIssuer: buildAuthServerMetadata(env.BASE_URL).issuer,
        issParameterSupported: true,
      });
      expect(redirect.searchParams.getAll("state")).toEqual(["issuer-response-state"]);
      expect(redirect.searchParams.getAll("keep")).toEqual(["1"]);

      if (decision === "deny") {
        expect(redirect.searchParams.getAll("error")).toEqual(["access_denied"]);
        expect(redirect.searchParams.has("code")).toBe(false);
      } else {
        expect(redirect.searchParams.has("error")).toBe(false);
        const codes = redirect.searchParams.getAll("code");
        expect(codes).toHaveLength(1);
        const code = codes[0];
        assert(code !== undefined && code.length > 0);
        const exchanged = await exchangeMcpGrant(
          f.ownerDb,
          {
            ...f.codeGrant(),
            code,
            redirect_uri: registeredRedirectUri,
            resource: mcpResource(),
          },
          AbortSignal.timeout(10_000),
        );
        assert(exchanged.ok);
        const claims = decodeJwt(exchanged.value.access_token);
        const metadata = buildAuthServerMetadata(env.BASE_URL);
        expect(metadata.issuer).toBe(env.BASE_URL);
        expect(claims.iss).toBe(metadata.issuer);
        expect(claims.iss).toBe(redirect.searchParams.get("iss"));
      }
    } finally {
      env.BASE_URL = previousBaseUrl;
    }
  },
);

test.each(["invalid_client", "invalid_target"] as const)(
  "%s authorization request cannot redirect or mutate credential stores",
  async (error) => {
    assert(fixtures !== undefined);
    const f = fixtures;
    const params = f.authorizationParams();
    params.set("csrf_token", f.csrfToken);
    params.set("iss", outerIssuer);
    const unsafeRedirect = "https://unregistered.example.test/callback?iss=foreign&keep=1";
    if (error === "invalid_client") {
      params.set("redirect_uri", unsafeRedirect);
    } else {
      params.set("resource", "https://foreign.example.test/api/mcp");
    }
    const authorizeUrl = new URL("/oauth/authorize", env.BASE_URL);
    authorizeUrl.search = params.toString();
    const headers = f.headers();
    headers.set("content-type", "application/x-www-form-urlencoded");
    const db = error === "invalid_client" ? f.ownerDb : f.noAccessDb;
    const before = await f.snapshot();
    const outcome = await createAuthorizationHandlers(db)
      .POST(new NextRequest(authorizeUrl, { method: "POST", headers, body: "decision=approve" }))
      .then(
        (response) => ({ ok: true as const, response }),
        (cause: unknown) => ({ ok: false as const, cause }),
      );
    expect(await f.snapshot()).toEqual(before);
    if (!outcome.ok) throw outcome.cause;
    expect(outcome.response.status).toBe(400);
    expect(outcome.response.headers.get("location")).toBeNull();
    const body = await outcome.response.text();
    expect(body).toBe(JSON.stringify({ error }));
    for (const value of [
      unsafeRedirect,
      outerIssuer,
      f.code,
      f.refreshToken,
      f.verifier,
      f.sessionCredential,
      f.csrfToken,
    ]) {
      expect(body).not.toContain(value);
    }
  },
);
