import { describe, expect, it } from "vitest";
import { evaluateSessionAccess } from "./accessPolicy";

const now = new Date("2026-10-31T10:00:00Z");
const base = {
  active: true,
  emailVerified: true,
  isAdmin: false,
  twoFactorEnabled: false,
  requireMfaForAll: false,
  assurance: "password",
  lastSeenAt: new Date("2026-10-31T09:59:00Z"),
  expiresAt: new Date("2026-10-31T11:00:00Z"),
  createdAt: new Date("2026-10-31T09:00:00Z"),
  idleMinutes: 30,
  absoluteHours: 168,
  now,
};

describe("authentication assurance policy", () => {
  it("admits verified active regular users only after authentication finishes", () => {
    expect(evaluateSessionAccess(base)).toEqual({ allowed: true });
    expect(evaluateSessionAccess({ ...base, assurance: "pending" })).toEqual({
      allowed: false,
      reason: "mfa",
    });
    expect(evaluateSessionAccess({ ...base, active: false }).allowed).toBe(false);
    expect(evaluateSessionAccess({ ...base, emailVerified: false })).toEqual({
      allowed: false,
      reason: "verification",
    });
  });
  it("requires strong assurance for administrators, enrolled users and mandatory MFA policy", () => {
    for (const policy of [
      { isAdmin: true },
      { twoFactorEnabled: true },
      { requireMfaForAll: true },
    ]) {
      expect(evaluateSessionAccess({ ...base, ...policy })).toEqual({
        allowed: false,
        reason: "mfa",
      });
      expect(evaluateSessionAccess({ ...base, ...policy, assurance: "mfa" }).allowed).toBe(true);
      expect(evaluateSessionAccess({ ...base, ...policy, assurance: "passkey" }).allowed).toBe(
        true,
      );
    }
  });
  it("expires at the idle, absolute and server expiration boundaries", () => {
    expect(
      evaluateSessionAccess({ ...base, lastSeenAt: new Date("2026-10-31T09:30:00Z") }),
    ).toEqual({ allowed: false, reason: "expired" });
    expect(
      evaluateSessionAccess({ ...base, createdAt: new Date("2026-10-24T10:00:00Z") }).allowed,
    ).toBe(false);
    expect(evaluateSessionAccess({ ...base, expiresAt: now }).allowed).toBe(false);
  });
});
