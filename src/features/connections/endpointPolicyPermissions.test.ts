import { describe, expect, it } from "vitest";
import type { ConnectionEndpointPolicy } from "./connectionEndpoint";
import { resolveConnectionEndpoint } from "./endpointPolicy";

const endpoint = { protocol: "imaps" as const, host: "mail.corp.internal", port: 993 };
const signal = () => new AbortController().signal;
const dns =
  (address: string, family: 4 | 6 = 4) =>
  () =>
    Promise.resolve([{ address, family }]);

describe("operator-managed internal endpoint grants", () => {
  it("permits an exact internal host/protocol/port and restricts supplied addresses", async () => {
    const policy = { internalEndpoints: [{ ...endpoint, allowedAddresses: ["10.2.3.4"] }] };
    const approved = await resolveConnectionEndpoint(endpoint, policy, signal(), dns("10.2.3.4"));
    expect(approved.ok).toBe(true);
    expect(await resolveConnectionEndpoint(endpoint, policy, signal(), dns("10.2.3.5"))).toEqual({
      ok: false,
      error: { code: "blocked_address" },
    });
  });

  it.each([
    { ...endpoint, host: "other.corp.internal" },
    { ...endpoint, port: 994 },
    { ...endpoint, protocol: "smtps" as const },
  ])("cannot borrow a grant for a different endpoint", async (request) => {
    const result = await resolveConnectionEndpoint(
      request,
      { internalEndpoints: [endpoint] },
      signal(),
      dns("10.2.3.4"),
    );
    expect(result).toEqual({ ok: false, error: { code: "blocked_hostname" } });
  });

  it("allows ULA only for an operator-managed internal endpoint", async () => {
    const result = await resolveConnectionEndpoint(
      endpoint,
      { internalEndpoints: [endpoint] },
      signal(),
      dns("fd12::1", 6),
    );
    expect(result.ok).toBe(true);
  });

  it("requires a separate explicit loopback permission", async () => {
    const local = { ...endpoint, host: "localhost" };
    expect(
      await resolveConnectionEndpoint(
        local,
        { internalEndpoints: [local] },
        signal(),
        dns("127.0.0.1"),
      ),
    ).toEqual({
      ok: false,
      error: { code: "blocked_address" },
    });
    const allowed = await resolveConnectionEndpoint(
      local,
      {
        internalEndpoints: [{ ...local, allowLoopback: true, allowedAddresses: ["127.0.0.1"] }],
      },
      signal(),
      dns("127.0.0.1"),
    );
    expect(allowed.ok).toBe(true);
  });

  it.each([
    "169.254.169.254",
    "100.100.100.200",
    "0.0.0.0",
    "224.0.0.1",
    "fe80::1",
    "fd00:ec2::254",
    "fd00:ec2::23",
    "fd20:ce::254",
    "FD00:0EC2:0000:0000:0000:0000:0000:0254",
    "::",
  ])("never permits hard-blocked %s even with a matching grant", async (address) => {
    const policy = {
      internalEndpoints: [{ ...endpoint, allowLoopback: true, allowedAddresses: [address] }],
    };
    const result = await resolveConnectionEndpoint(
      endpoint,
      policy,
      signal(),
      dns(address, address.includes(":") ? 6 : 4),
    );
    expect(result).toEqual({ ok: false, error: { code: "blocked_address" } });
  });

  it("checks all answers against exact operator pins", async () => {
    const result = await resolveConnectionEndpoint(
      endpoint,
      {
        internalEndpoints: [{ ...endpoint, allowedAddresses: ["10.2.3.4"] }],
      },
      signal(),
      () =>
        Promise.resolve([
          { address: "10.2.3.4", family: 4 },
          { address: "10.2.3.5", family: 4 },
        ]),
    );
    expect(result).toEqual({ ok: false, error: { code: "blocked_address" } });
  });

  it("rejects ambiguous duplicate policy entries", async () => {
    const result = await resolveConnectionEndpoint(
      endpoint,
      { internalEndpoints: [endpoint, endpoint] },
      signal(),
      dns("10.2.3.4"),
    );
    expect(result).toEqual({ ok: false, error: { code: "invalid_policy" } });
  });

  it("rejects invalid custom CA material before opening a connection", async () => {
    const policy: ConnectionEndpointPolicy = {
      internalEndpoints: [{ ...endpoint, ca: "not a certificate" }],
    };
    const result = await resolveConnectionEndpoint(endpoint, policy, signal(), dns("10.2.3.4"));
    expect(result).toEqual({ ok: false, error: { code: "invalid_policy" } });
  });
});
