import { expect, test } from "vitest";
import { env } from "@/config/env";
import { authorizationPostQueryInput, authorizationRequestInput } from "./authorize";
import { tokenRequestInput } from "./exchange";
import { buildAuthServerMetadata, buildProtectedResourceMetadata } from "./metadata";

const resource = `${env.BASE_URL.replace(/\/$/, "")}/api/mcp`;
const authorization = {
  client_id: "resource-policy-client",
  redirect_uri: "https://client.example.test/callback",
  response_type: "code",
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
  state: "resource-policy-state",
};
const requests = [
  { name: "authorization GET", schema: authorizationRequestInput, input: authorization },
  {
    name: "authorization POST",
    schema: authorizationPostQueryInput,
    input: { ...authorization, csrf_token: "resource-policy-csrf" },
  },
  {
    name: "authorization-code exchange",
    schema: tokenRequestInput,
    input: {
      grant_type: "authorization_code",
      client_id: authorization.client_id,
      redirect_uri: authorization.redirect_uri,
      code: "resource-policy-code",
      code_verifier: "a".repeat(64),
    },
  },
  {
    name: "refresh exchange",
    schema: tokenRequestInput,
    input: {
      grant_type: "refresh_token",
      client_id: authorization.client_id,
      refresh_token: "resource-policy-refresh",
    },
  },
];
const otherTargets = [
  { variant: "foreign origin", target: "https://foreign.example.test/api/mcp" },
  { variant: "different path", target: new URL("/other-resource", env.BASE_URL).href },
  { variant: "query", target: `${resource}?other=1` },
  { variant: "fragment", target: `${resource}#other` },
];

test.each(requests)("$name accepts the advertised MCP resource", ({ schema, input }) => {
  expect(schema.safeParse({ ...input, resource }).success).toBe(true);
});

test.each(requests.flatMap((request) => otherTargets.map((other) => ({ ...request, ...other }))))(
  "$name rejects a $variant resource",
  ({ schema, input, target }) => {
    expect(schema.safeParse({ ...input, resource: target }).success).toBe(false);
  },
);

test("authorization metadata preserves the configured issuer literal used by existing tokens", () => {
  const issuer = "https://app.example.test/";
  expect(buildAuthServerMetadata(issuer).issuer).toBe(issuer);
});

test("protected-resource discovery identifies the same configured issuer literal", () => {
  const issuer = "https://app.example.test/";
  expect(buildProtectedResourceMetadata(issuer).authorization_servers).toEqual([issuer]);
});
