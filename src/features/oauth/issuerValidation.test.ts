import {
  IssuerMismatchError,
  validateAuthorizationResponseIssuer,
} from "@modelcontextprotocol/client";
import { expect, test } from "vitest";

const issuers = [
  "https://crm.example.test",
  "https://crm.example.test/",
  "HTTPS://CRM.Example.Test/",
];

function callbackIssuer(issuer: string): string | undefined {
  const callback = new URL("https://client.example.test/callback");
  callback.searchParams.set("iss", issuer);
  return callback.searchParams.get("iss") ?? undefined;
}

test.each(issuers)("SDK accepts the form-decoded literal issuer %s", (issuer) => {
  expect(() =>
    validateAuthorizationResponseIssuer({
      iss: callbackIssuer(issuer),
      expectedIssuer: issuer,
      issParameterSupported: true,
    }),
  ).not.toThrow();
});

test("SDK rejects a missing issuer when response identification is advertised", () => {
  expect(() =>
    validateAuthorizationResponseIssuer({
      iss: undefined,
      expectedIssuer: "https://crm.example.test",
      issParameterSupported: true,
    }),
  ).toThrow(IssuerMismatchError);
});

test("SDK retains the unadvertised missing-issuer compatibility branch", () => {
  expect(() =>
    validateAuthorizationResponseIssuer({
      iss: undefined,
      expectedIssuer: "https://crm.example.test",
      issParameterSupported: false,
    }),
  ).not.toThrow();
});

test.each(
  [true, false].flatMap((supported) =>
    ["", "https://foreign.example.test"].map((received) => ({ supported, received })),
  ),
)("SDK rejects issuer $received with support flag $supported", ({ supported, received }) => {
  expect(() =>
    validateAuthorizationResponseIssuer({
      iss: callbackIssuer(received),
      expectedIssuer: "https://crm.example.test",
      issParameterSupported: supported,
    }),
  ).toThrow(IssuerMismatchError);
});

test.each([
  { expected: "https://crm.example.test", received: "https://crm.example.test/" },
  { expected: "HTTPS://CRM.Example.Test/", received: "https://crm.example.test/" },
  { expected: "https://crm.example.test:443/", received: "https://crm.example.test/" },
  {
    expected: "https://crm.example.test/tenant%2FA/",
    received: "https://crm.example.test/tenant%2fA/",
  },
  { expected: "https://crm.example.test/Tenant/", received: "https://crm.example.test/tenant/" },
])("SDK never normalizes $received to the recorded $expected", ({ expected, received }) => {
  expect(() =>
    validateAuthorizationResponseIssuer({
      iss: callbackIssuer(received),
      expectedIssuer: expected,
      issParameterSupported: true,
    }),
  ).toThrow(IssuerMismatchError);
});
