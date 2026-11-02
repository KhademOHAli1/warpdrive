import { describe, expect, it, vi } from "vitest";
import type { ConnectionEndpointInput, EndpointDnsAddress } from "./connectionEndpoint";
import { resolveConnectionEndpoint } from "./endpointPolicy";

const input = { protocol: "imaps" as const, host: "mail.example.com", port: 993 };
const policy = { internalEndpoints: [] };
const signal = () => new AbortController().signal;
const dns = () => Promise.resolve([{ address: "93.184.216.34", family: 4 as const }]);

describe("connection endpoint normalization and cancellation", () => {
  it.each([
    "127.1",
    "2130706433",
    "0177.0.0.1",
    "0x7f000001",
    "1234",
    "mail..example.com",
    "a_b.example.com",
    "*.example.com",
    "imap://mail.example.com",
    "user:secret@mail.example.com",
    "mail.example.com/path",
    "mail.example.com?x=secret",
    "mail.example.com#secret",
    "mail.example.com\\other",
    "mail.example.com\n",
    "fe80::1%lo0",
  ])("rejects malformed or alternate host syntax without DNS: %s", async (host) => {
    const resolver = vi.fn(dns);
    const result = await resolveConnectionEndpoint({ ...input, host }, policy, signal(), resolver);
    expect(result).toEqual({ ok: false, error: { code: "invalid_endpoint" } });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(["localhost", "sub.localhost", "mail.local", "mail.internal", "mail"])(
    "rejects local-only hostname %s without an operator grant",
    async (host) => {
      const resolver = vi.fn(dns);
      expect(
        await resolveConnectionEndpoint({ ...input, host }, policy, signal(), resolver),
      ).toEqual({
        ok: false,
        error: { code: "blocked_hostname" },
      });
      expect(resolver).not.toHaveBeenCalled();
    },
  );

  it("never permits a known metadata hostname", async () => {
    const metadata = { ...input, host: "metadata.google.internal" };
    const result = await resolveConnectionEndpoint(
      metadata,
      { internalEndpoints: [{ ...metadata, allowLoopback: true }] },
      signal(),
      dns,
    );
    expect(result).toEqual({ ok: false, error: { code: "blocked_hostname" } });
  });

  it("uses the canonical IDNA hostname for DNS and TLS", async () => {
    const resolver = vi.fn(dns);
    const result = await resolveConnectionEndpoint(
      { ...input, host: "MAIL.مثال.ir" },
      policy,
      signal(),
      resolver,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hostname).toBe("mail.xn--mgbh0fb.ir");
    expect(result.value.tls.servername).toBe("mail.xn--mgbh0fb.ir");
    expect(resolver).toHaveBeenCalledWith("mail.xn--mgbh0fb.ir", expect.any(AbortSignal));
  });

  it.each([
    { ...input, protocol: "imap" },
    { ...input, protocol: "http" },
    { ...input, port: 0 },
    { ...input, port: 65536 },
    { ...input, port: 993.5 },
  ])("rejects insecure protocols and invalid ports", async (request) => {
    expect(
      await resolveConnectionEndpoint(request as ConnectionEndpointInput, policy, signal(), dns),
    ).toEqual({
      ok: false,
      error: { code: "invalid_endpoint" },
    });
  });

  it("does not leak DNS errors or credential-like input in diagnostics", async () => {
    const result = await resolveConnectionEndpoint(input, policy, signal(), () =>
      Promise.reject(new Error("secret-password-and-user")),
    );
    expect(result).toEqual({ ok: false, error: { code: "dns_failed" } });
  });

  it.each([
    { rows: [] },
    { rows: [{ address: "not-an-IP", family: 4 }] },
    { rows: [{ address: "::1", family: 4 }] },
  ])("fails closed for empty, malformed, and mismatched DNS answers", async ({ rows }) => {
    const result = await resolveConnectionEndpoint(input, policy, signal(), () =>
      Promise.resolve(rows as EndpointDnsAddress[]),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an oversized DNS answer set", async () => {
    const result = await resolveConnectionEndpoint(input, policy, signal(), () =>
      Promise.resolve(
        Array.from({ length: 65 }, () => ({ address: "93.184.216.34", family: 4 as const })),
      ),
    );
    expect(result).toEqual({ ok: false, error: { code: "dns_failed" } });
  });

  it("never resolves DNS for an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const resolver = vi.fn(dns);
    await expect(
      resolveConnectionEndpoint(input, policy, controller.signal, resolver),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("returns promptly when cancellation occurs during a DNS lookup", async () => {
    const controller = new AbortController();
    let finish = (rows: readonly EndpointDnsAddress[]) => {
      void rows;
    };
    const pending = new Promise<readonly EndpointDnsAddress[]>((resolve) => {
      finish = resolve;
    });
    const result = resolveConnectionEndpoint(input, policy, controller.signal, async () => pending);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    finish([{ address: "93.184.216.34", family: 4 }]);
  });
});
