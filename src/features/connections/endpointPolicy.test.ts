import { describe, expect, it, vi } from "vitest";
import { resolveConnectionEndpoint } from "./endpointPolicy";

const signal = () => new AbortController().signal;
const publicDns = vi.fn(() => Promise.resolve([{ address: "93.184.216.34", family: 4 as const }]));

describe("connection endpoint policy", () => {
  it("pins an approved address while retaining DNS identity and verified TLS", async () => {
    const result = await resolveConnectionEndpoint(
      { protocol: "imaps", host: "MAIL.Example.com.", port: 993 },
      { internalEndpoints: [] },
      signal(),
      publicDns,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        protocol: "imaps",
        hostname: "mail.example.com",
        address: "93.184.216.34",
        family: 4,
        port: 993,
        tls: {
          servername: "mail.example.com",
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        },
      },
    });
    expect(publicDns).toHaveBeenCalledWith("mail.example.com", expect.any(AbortSignal));
  });

  it("checks every DNS answer before returning a pin", async () => {
    const result = await resolveConnectionEndpoint(
      { protocol: "smtp+starttls", host: "mail.example.com", port: 587 },
      { internalEndpoints: [] },
      signal(),
      () =>
        Promise.resolve([
          { address: "93.184.216.34", family: 4 },
          { address: "169.254.169.254", family: 4 },
        ]),
    );
    expect(result).toEqual({ ok: false, error: { code: "blocked_address" } });
  });
});
