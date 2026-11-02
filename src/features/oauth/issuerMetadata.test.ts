import { afterEach, expect, test } from "vitest";
import { GET as authorizationMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { env } from "@/config/env";
import { buildAuthServerMetadata } from "./metadata";

const original = {
  issuer: env.BASE_URL,
  enabled: env.MCP_ENABLED,
  registration: env.OAUTH_REGISTRATION,
};
afterEach(() => {
  env.BASE_URL = original.issuer;
  env.MCP_ENABLED = original.enabled;
  env.OAUTH_REGISTRATION = original.registration;
});

const issuers = [
  "https://crm.example.test",
  "https://crm.example.test/",
  "HTTPS://CRM.Example.Test/",
];
const registrationModes = ["open", "disabled"] as const;

test.each(
  issuers.flatMap((issuer) => registrationModes.map((registration) => ({ issuer, registration }))),
)(
  "advertises issuer-response support for $issuer with registration $registration",
  async ({ issuer, registration }) => {
    env.BASE_URL = issuer;
    env.MCP_ENABLED = true;
    env.OAUTH_REGISTRATION = registration;
    const built = buildAuthServerMetadata(issuer, { registration });
    expect(built.issuer).toBe(issuer);
    expect(built).toHaveProperty("authorization_response_iss_parameter_supported", true);

    const response = authorizationMetadata();
    expect(response.status).toBe(200);
    const document: unknown = await response.json();
    expect(document).toMatchObject({
      issuer,
      authorization_response_iss_parameter_supported: true,
    });
  },
);
