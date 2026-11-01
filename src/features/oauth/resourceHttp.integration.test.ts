import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { env } from "@/config/env";
import { CSRF_COOKIE } from "@/features/auth/csrf";
import { SESSION_COOKIE } from "@/features/auth/session";
import { resetRateLimitsForTest } from "@/server/rateLimitGuard";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createMcpResourceFixtures,
  type McpResourceFixtures,
  mcpResource,
} from "@/test/mcpResourceFixtures";
import { createAuthorizationHandlers } from "./authorizationHttp";
import { sha256Base64Url } from "./pkce";
import { createTokenHandler } from "./tokenHttp";
import { verifyAccessToken } from "./tokens";

let h: TestDb | undefined;
let fixtures: McpResourceFixtures | undefined;
beforeEach(async () => {
  resetRateLimitsForTest();
  h = await makeTestDb();
  fixtures = await createMcpResourceFixtures(h);
});
afterEach(async () => {
  try {
    await fixtures?.close();
  } finally {
    await h?.close();
    fixtures = undefined;
    h = undefined;
    resetRateLimitsForTest();
  }
});

function currentFixtures(): McpResourceFixtures {
  assert(fixtures !== undefined);
  return fixtures;
}

type Grant = "authorization_code" | "refresh_token";
type Encoding = "json" | "form";
type ResourceVariant = "missing" | "wrong" | "duplicate" | "identical" | "escaped";
const foreignResource = "https://foreign.example.test/api/mcp";
const grants: Grant[] = ["authorization_code", "refresh_token"];
const encodings: Encoding[] = ["json", "form"];
const tokenVariants: { encoding: Encoding; variant: ResourceVariant }[] = [
  { encoding: "json", variant: "missing" },
  { encoding: "json", variant: "wrong" },
  { encoding: "json", variant: "duplicate" },
  { encoding: "json", variant: "identical" },
  { encoding: "json", variant: "escaped" },
  { encoding: "form", variant: "missing" },
  { encoding: "form", variant: "wrong" },
  { encoding: "form", variant: "duplicate" },
  { encoding: "form", variant: "identical" },
];

function resourceValues(variant: ResourceVariant): string[] {
  if (variant === "missing") return [];
  if (variant === "wrong") return [foreignResource];
  if (variant === "identical") return [mcpResource(), mcpResource()];
  return [foreignResource, mcpResource()];
}

function grantFields(f: McpResourceFixtures, grant: Grant): Record<string, string> {
  return grant === "authorization_code"
    ? {
        grant_type: grant,
        client_id: f.clientId,
        redirect_uri: f.redirectUri,
        code_verifier: f.verifier,
        code: f.code,
      }
    : { grant_type: grant, client_id: f.clientId, refresh_token: f.refreshToken };
}

function tokenRequest(
  f: McpResourceFixtures,
  grant: Grant,
  encoding: Encoding,
  resources: string[],
  escaped = false,
): Request {
  const fields = grantFields(f, grant);
  const headers = f.headers();
  let body: string;
  if (encoding === "json") {
    headers.set("content-type", "application/json");
    const members = Object.entries(fields).map(
      ([name, value]) => `${JSON.stringify(name)}:${JSON.stringify(value)}`,
    );
    resources.forEach((value, index) => {
      const name = escaped && index === 1 ? String.raw`"res\u006furce"` : '"resource"';
      members.push(`${name}:${JSON.stringify(value)}`);
    });
    body = `{${members.join(",")}}`;
  } else {
    headers.set("content-type", "application/x-www-form-urlencoded");
    const params = new URLSearchParams(fields);
    for (const resource of resources) params.append("resource", resource);
    body = params.toString();
  }
  return new Request(new URL("/oauth/token", env.BASE_URL), { method: "POST", headers, body });
}

async function expectInvalidTargetWithoutMutation(
  f: McpResourceFixtures,
  request: () => Promise<Response>,
) {
  const before = await f.snapshot();
  const outcome = await request().then(
    (response) => ({ ok: true as const, response }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  expect(await f.snapshot()).toEqual(before);
  if (!outcome.ok) throw outcome.error;
  expect(outcome.response.status).toBe(400);
  expect(outcome.response.headers.get("location")).toBeNull();
  const body = await outcome.response.text();
  expect(body).toBe(JSON.stringify({ error: "invalid_target" }));
  for (const credential of [f.code, f.refreshToken, f.verifier, f.sessionCredential, f.csrfToken]) {
    expect(body).not.toContain(credential);
  }
}

test.each(grants.flatMap((grant) => tokenVariants.map((variant) => ({ grant, ...variant }))))(
  "$grant token HTTP rejects $variant $encoding resource before credential mutation",
  async ({ grant, encoding, variant }) => {
    const f = currentFixtures();
    const handler = createTokenHandler(f.ownerDb);
    await expectInvalidTargetWithoutMutation(f, () =>
      handler(tokenRequest(f, grant, encoding, resourceValues(variant), variant === "escaped")),
    );
  },
);

const tokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
});

test.each(grants.flatMap((grant) => encodings.map((encoding) => ({ grant, encoding }))))(
  "$grant token HTTP accepts one advertised resource through $encoding decoding",
  async ({ grant, encoding }) => {
    const f = currentFixtures();
    const before = await f.snapshot();
    const response = await createTokenHandler(f.ownerDb)(
      tokenRequest(f, grant, encoding, [mcpResource()]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    const tokens = tokenResponse.parse(await response.json());
    expect(tokens.refresh_token).not.toBe(f.refreshToken);
    expect(
      (await verifyAccessToken(f.ownerDb, tokens.access_token, AbortSignal.timeout(5_000))).ok,
    ).toBe(true);
    const after = await f.snapshot();
    expect(after.access).toHaveLength(before.access.length + 1);
    expect(after.refresh).toHaveLength(before.refresh.length + 1);
    if (grant === "authorization_code") {
      expect(
        after.codes.find((row) => row.codeHash === sha256Base64Url(f.code))?.consumedAt,
      ).toBeInstanceOf(Date);
    } else {
      const rotated = after.refresh.find(
        (row) => row.tokenHash === sha256Base64Url(f.refreshToken),
      );
      expect(rotated?.revokedAt).toBeInstanceOf(Date);
      expect(rotated?.rotatedTo).toBe(sha256Base64Url(tokens.refresh_token));
    }
  },
);

const authorizationVariants: ResourceVariant[] = ["missing", "wrong", "duplicate", "identical"];
const methods = ["GET", "POST"] as const;
test.each(
  methods.flatMap((method) => authorizationVariants.map((variant) => ({ method, variant }))),
)(
  "$method authorization rejects $variant resource before any client or session lookup",
  async ({ method, variant }) => {
    const f = currentFixtures();
    const params = f.authorizationParams(resourceValues(variant));
    const headers = f.headers();
    if (method === "POST") {
      params.set("csrf_token", f.csrfToken);
      headers.set("content-type", "application/x-www-form-urlencoded");
    }
    const url = new URL("/oauth/authorize", env.BASE_URL);
    url.search = params.toString();
    const req = new NextRequest(url, {
      method,
      headers,
      ...(method === "POST" ? { body: "decision=approve" } : {}),
    });
    const handler = createAuthorizationHandlers(f.noAccessDb)[method];
    await expectInvalidTargetWithoutMutation(f, () => handler(req));
  },
);

test("valid authorization GET and CSRF-protected POST preserve the native consent and code journey", async () => {
  const f = currentFixtures();
  const handlers = createAuthorizationHandlers(f.ownerDb);
  const headers = f.headers();
  headers.set("cookie", `${SESSION_COOKIE}=${f.sessionCredential}`);
  const authorizeUrl = new URL("/oauth/authorize", env.BASE_URL);
  authorizeUrl.search = f.authorizationParams().toString();
  const get = await handlers.GET(new NextRequest(authorizeUrl, { headers }));
  expect(get.status).toBe(302);
  const consentLocation = get.headers.get("location");
  assert(consentLocation !== null);
  const consentUrl = new URL(consentLocation);
  expect(consentUrl.pathname).toBe("/oauth/authorize/consent");
  expect(consentUrl.searchParams.get("resource")).toBe(mcpResource());
  expect(consentUrl.searchParams.get("state")).toBe("native-resource-state");
  const setCookie = get.headers.get("set-cookie");
  assert(setCookie !== null);
  const csrf = /(?:^|;\s*)wd_csrf=([^;]+)/.exec(setCookie)?.[1];
  assert(csrf !== undefined);
  expect(setCookie.toLowerCase()).toContain("samesite=lax");

  const params = f.authorizationParams();
  params.set("csrf_token", csrf);
  authorizeUrl.search = params.toString();
  headers.set("cookie", `${SESSION_COOKIE}=${f.sessionCredential}; ${CSRF_COOKIE}=${csrf}`);
  headers.set("content-type", "application/x-www-form-urlencoded");
  const before = await f.snapshot();
  const post = await handlers.POST(
    new NextRequest(authorizeUrl, { method: "POST", headers, body: "decision=approve" }),
  );
  expect(post.status).toBe(302);
  const location = post.headers.get("location");
  assert(location !== null);
  const redirect = new URL(location);
  expect(`${redirect.origin}${redirect.pathname}`).toBe(f.redirectUri);
  expect(redirect.searchParams.get("state")).toBe("native-resource-state");
  const code = redirect.searchParams.get("code");
  assert(code !== null);
  const after = await f.snapshot();
  expect(after.codes).toHaveLength(before.codes.length + 1);
  expect(after.codes.find((row) => row.codeHash === sha256Base64Url(code))?.consumedAt).toBeNull();

  const tokenHeaders = f.headers();
  tokenHeaders.set("content-type", "application/json");
  const exchange = await createTokenHandler(f.ownerDb)(
    new Request(new URL("/oauth/token", env.BASE_URL), {
      method: "POST",
      headers: tokenHeaders,
      body: JSON.stringify({ ...f.codeGrant(), code }),
    }),
  );
  expect(exchange.status).toBe(200);
  tokenResponse.parse(await exchange.json());
  const exchanged = await f.snapshot();
  expect(
    exchanged.codes.find((row) => row.codeHash === sha256Base64Url(code))?.consumedAt,
  ).toBeInstanceOf(Date);
});
