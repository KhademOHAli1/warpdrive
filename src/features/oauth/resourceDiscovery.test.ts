import { afterEach, expect, test } from "vitest";
import { GET as authorizationMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as protectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { POST as register } from "@/app/oauth/register/route";
import { env } from "@/config/env";

const original = {
  baseUrl: env.BASE_URL,
  mcpEnabled: env.MCP_ENABLED,
  registration: env.OAUTH_REGISTRATION,
};
afterEach(() => {
  env.BASE_URL = original.baseUrl;
  env.MCP_ENABLED = original.mcpEnabled;
  env.OAUTH_REGISTRATION = original.registration;
});

const invalidProfiles = [
  "http://crm.example.test",
  "https://crm.example.test?foreign=1",
  "https://user:secret@crm.example.test",
];
const boundaries = [
  { name: "authorization metadata", request: () => authorizationMetadata() },
  { name: "protected resource metadata", request: () => protectedResourceMetadata() },
  {
    name: "client registration",
    // Invalid content type keeps the unguarded baseline away from the database too.
    request: () =>
      register(new Request("https://crm.example.test/oauth/register", { method: "POST" })),
  },
];

test.each(
  boundaries.flatMap((boundary) => invalidProfiles.map((baseUrl) => ({ ...boundary, baseUrl }))),
)("$name rejects invalid MCP profile $baseUrl", async ({ baseUrl, request }) => {
  env.BASE_URL = baseUrl;
  env.MCP_ENABLED = true;
  env.OAUTH_REGISTRATION = "open";
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain(baseUrl);
});

const registrationModes = ["open", "disabled"] as const;
test.each(
  ["https://crm.example.test", "https://crm.example.test/"].flatMap((baseUrl) =>
    registrationModes.map((registration) => ({ baseUrl, registration })),
  ),
)(
  "valid discovery preserves exact metadata for $baseUrl with registration $registration",
  async ({ baseUrl, registration }) => {
    env.BASE_URL = baseUrl;
    env.MCP_ENABLED = true;
    env.OAUTH_REGISTRATION = registration;
    const authorization = authorizationMetadata();
    expect(authorization.status).toBe(200);
    expect(await authorization.json()).toEqual({
      issuer: baseUrl,
      authorization_endpoint: "https://crm.example.test/oauth/authorize",
      token_endpoint: "https://crm.example.test/oauth/token",
      ...(registration === "open"
        ? { registration_endpoint: "https://crm.example.test/oauth/register" }
        : {}),
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
    const resource = protectedResourceMetadata();
    expect(resource.status).toBe(200);
    expect(await resource.json()).toEqual({
      resource: "https://crm.example.test/api/mcp",
      authorization_servers: [baseUrl],
    });
  },
);

test.each(boundaries)("$name stays disabled with a valid MCP profile", async ({ request }) => {
  env.BASE_URL = "https://crm.example.test/";
  env.MCP_ENABLED = false;
  env.OAUTH_REGISTRATION = "open";
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("Not found");
});
