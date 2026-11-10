import { expect, test } from "vitest";
import { resolveMcpResourceProfile, validateMcpResource } from "./resource";

const issuer = "https://app.example.test/";
const resource = "https://app.example.test/api/mcp";
const invalidTarget = { ok: false, error: "invalid_target" };

test.each([
  { base: "https://app.example.test", expected: resource },
  { base: issuer, expected: resource },
  {
    base: "HTTPS://APP.Example.test/",
    expected: "HTTPS://APP.Example.test/api/mcp",
  },
  {
    base: "https://app.example.test:443/",
    expected: "https://app.example.test:443/api/mcp",
  },
  {
    base: "https://app.example.test:8443/tenant/",
    expected: "https://app.example.test:8443/tenant/api/mcp",
  },
  {
    base: "https://app.example.test/tenant//",
    expected: "https://app.example.test/tenant//api/mcp",
  },
  {
    base: "https://app.example.test/tenant%2FA/",
    expected: "https://app.example.test/tenant%2FA/api/mcp",
  },
  {
    base: "https://app.example.test/tenant%FF/",
    expected: "https://app.example.test/tenant%FF/api/mcp",
  },
])("preserves configured issuer and resource bytes for $base", ({ base, expected }) => {
  expect(resolveMcpResourceProfile(base)).toEqual({
    ok: true,
    value: { issuer: base, resource: expected },
  });
  expect(validateMcpResource(base, expected)).toEqual({ ok: true, value: expected });
});

test.each([
  resource,
  "HTTPS://app.example.test/api/mcp",
  "https://APP.EXAMPLE.TEST/api/mcp",
  "HtTpS://APP.Example.Test/api/mcp",
])("accepts only scheme and host case variants: %s", (candidate) => {
  expect(validateMcpResource(issuer, candidate)).toEqual({ ok: true, value: resource });
});

test.each([
  { name: "absent value", value: undefined },
  { name: "null", value: null },
  { name: "empty string", value: "" },
  { name: "number", value: 1 },
  { name: "object", value: { resource } },
  { name: "one-element array", value: [resource] },
  { name: "identical repeated array", value: [resource, resource] },
  { name: "foreign origin", value: "https://foreign.example.test/api/mcp" },
  { name: "different path", value: "https://app.example.test/other" },
  { name: "path case", value: "https://app.example.test/API/mcp" },
  { name: "trailing slash", value: `${resource}/` },
  { name: "query", value: `${resource}?other=1` },
  { name: "empty query", value: `${resource}?` },
  { name: "fragment", value: `${resource}#other` },
  { name: "empty fragment", value: `${resource}#` },
  { name: "credentials", value: "https://user:secret@app.example.test/api/mcp" },
  { name: "empty credentials", value: "https://@app.example.test/api/mcp" },
  { name: "leading space", value: ` ${resource}` },
  { name: "trailing newline", value: `${resource}\n` },
  { name: "hostname tab", value: "https://app.exa\tmple.test/api/mcp" },
  { name: "path newline", value: "https://app.example.test/\napi/mcp" },
  { name: "format character", value: "https://app.exam\u200bple.test/api/mcp" },
  { name: "backslash", value: "https://app.example.test\\api/mcp" },
  { name: "missing authority separator", value: "https:app.example.test/api/mcp" },
  { name: "extra authority separator", value: "https:////app.example.test/api/mcp" },
  { name: "percent-encoded hostname", value: "https://%61pp.example.test/api/mcp" },
  { name: "trailing-dot hostname alias", value: "https://app.example.test./api/mcp" },
  { name: "added default port", value: "https://app.example.test:443/api/mcp" },
  { name: "empty port alias", value: "https://app.example.test:/api/mcp" },
  { name: "dot segment", value: "https://app.example.test/./api/mcp" },
  { name: "parent segment", value: "https://app.example.test/other/../api/mcp" },
  { name: "encoded dot", value: "https://app.example.test/%2e/api/mcp" },
  { name: "encoded parent", value: "https://app.example.test/other/%2E%2e/api/mcp" },
  { name: "mixed encoded parent", value: "https://app.example.test/other/.%2e/api/mcp" },
  { name: "invalid escape", value: "https://app.example.test/api/%mcp" },
  { name: "incomplete escape", value: "https://app.example.test/api/mcp%" },
])("rejects $name without reflecting input", ({ value }) => {
  expect(validateMcpResource(issuer, value)).toEqual(invalidTarget);
});

test.each([
  { base: "https://app.example.test:443/", value: resource },
  {
    base: "https://app.example.test:443/",
    value: "https://app.example.test:0443/api/mcp",
  },
  {
    base: "https://app.example.test/Tenant/",
    value: "https://app.example.test/tenant/api/mcp",
  },
  {
    base: "https://app.example.test/tenant//",
    value: "https://app.example.test/tenant/api/mcp",
  },
  {
    base: "https://app.example.test/tenant%2FA/",
    value: "https://app.example.test/tenant%2fA/api/mcp",
  },
  {
    base: "https://app.example.test/tenant%FF/",
    value: "https://app.example.test/tenant%ff/api/mcp",
  },
  { base: "https://127.0.0.1/", value: "https://2130706433/api/mcp" },
  { base: "https://127.0.0.1/", value: "https://0177.0.0.1/api/mcp" },
  { base: "https://127.0.0.1/", value: "https://0x7f000001/api/mcp" },
])("does not normalize $value into the configured resource", ({ base, value }) => {
  expect(validateMcpResource(base, value)).toEqual(invalidTarget);
});

test.each([
  "",
  "not-a-uri",
  "http://app.example.test/",
  "http://localhost/",
  "//app.example.test/",
  "https:app.example.test/",
  "https:////app.example.test/",
  "https://user:secret@app.example.test/",
  "https://@app.example.test/",
  "https://app.example.test/?",
  "https://app.example.test/#",
  "https://app.example.test/?x=1",
  "https://app.example.test/#x",
  " https://app.example.test/",
  "https://app.exa\tmple.test/",
  "https://app.exam\u200bple.test/",
  "https://app.example.test\\",
  "https://app.example.test/other/../",
  "https://app.example.test/%2e/",
  "https://app.example.test/other/.%2e/",
  "https://%61pp.example.test/",
  "https://app.example.test:/",
  "https://app.example.test:65536/",
  "https://app.example.test/bad%",
  "https://app.example.test/bad%F",
  "https://app.example.test/bad%0G",
  "https://app.example.test/bad%FF%",
  "https://app.example.test/\ud800",
])("fails closed for invalid MCP profile configuration: %s", (base) => {
  expect(resolveMcpResourceProfile(base)).toEqual(invalidTarget);
  expect(validateMcpResource(base, resource)).toEqual(invalidTarget);
});
