import { describe, expect, test } from "vitest";
import { readAuthRateLimitIp } from "./rateLimit";

describe("authentication proxy identity", () => {
  test("ignores forwarded identity unless an operator selected a trusted header", () => {
    const headers = new Headers({ "x-real-ip": "192.0.2.10", "x-forwarded-for": "198.51.100.1" });
    expect(readAuthRateLimitIp(headers, "none")).toBeNull();
    expect(readAuthRateLimitIp(headers, "x-real-ip")).toBe("192.0.2.10");
  });

  test("rejects ambiguous chains, ports and malformed addresses", () => {
    for (const value of ["192.0.2.1, 198.51.100.1", "192.0.2.1:8080", "user-controlled", ""]) {
      expect(
        readAuthRateLimitIp(new Headers({ "x-forwarded-for": value }), "x-forwarded-for"),
      ).toBeNull();
    }
  });

  test("normalizes IPv4-mapped addresses and limits IPv6 at the network boundary", () => {
    expect(
      readAuthRateLimitIp(new Headers({ "x-real-ip": "::ffff:192.0.2.10" }), "x-real-ip"),
    ).toBe("192.0.2.10");
    const first = readAuthRateLimitIp(
      new Headers({ "x-real-ip": "2001:db8:1234:abcd::1" }),
      "x-real-ip",
    );
    const second = readAuthRateLimitIp(
      new Headers({ "x-real-ip": "2001:0db8:1234:abcd:ffff::2" }),
      "x-real-ip",
    );
    expect(first).toBe("2001:db8:1234:abcd::/64");
    expect(second).toBe(first);
  });
});
