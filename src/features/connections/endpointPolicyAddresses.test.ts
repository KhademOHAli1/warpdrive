import { describe, expect, it } from "vitest";
import { resolveConnectionEndpoint } from "./endpointPolicy";

const blocked = [
  "0.0.0.0",
  "0.1.2.3",
  "10.0.0.1",
  "127.0.0.1",
  "127.99.1.1",
  "169.254.169.254",
  "169.254.1.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "100.64.0.1",
  "100.100.100.200",
  "100.127.255.254",
  "192.0.0.8",
  "192.0.2.1",
  "192.88.99.1",
  "198.18.1.1",
  "198.19.255.255",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "239.1.2.3",
  "240.0.0.1",
  "255.255.255.255",
  "::",
  "::1",
  "::ffff:127.0.0.1",
  "::ffff:10.0.0.1",
  "::ffff:169.254.169.254",
  "::ffff:192.0.2.1",
  "fc00::1",
  "fd12::1",
  "fe80::1",
  "fec0::1",
  "ff02::1",
  "::127.0.0.1",
  "64:ff9b::a9fe:a9fe",
  "2001::1",
  "2001:20::1",
  "2001:db8::1",
  "2002:7f00:1::",
  "3ffe::1",
  "3fff::1",
  "3fff:fff::1",
];

describe("endpoint address classes", () => {
  it.each(blocked)("rejects non-public literal %s by default", async (host) => {
    const result = await resolveConnectionEndpoint(
      { protocol: "imaps", host, port: 993 },
      { internalEndpoints: [] },
      new AbortController().signal,
    );
    expect(result).toEqual({ ok: false, error: { code: "blocked_address" } });
  });

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
  ])("accepts public unicast literal %s without sending SNI for an IP", async (host) => {
    const result = await resolveConnectionEndpoint(
      { protocol: "smtps", host, port: 465 },
      { internalEndpoints: [] },
      new AbortController().signal,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tls.servername).toBeUndefined();
    expect(result.value.tls.rejectUnauthorized).toBe(true);
  });
});
