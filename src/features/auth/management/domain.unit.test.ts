import { describe, expect, test } from "vitest";
import { invitationState, redactSecurityMetadata, validatePolicy } from "./domain";

describe("invitation admission state", () => {
  const future = new Date("2026-11-02T10:00:00Z");
  const now = new Date("2026-11-01T10:00:00Z");
  test("a consumed or revoked invitation never becomes usable when its expiry is extended", () => {
    expect(invitationState({ expiresAt: future, acceptedAt: now, revokedAt: null }, now)).toBe(
      "accepted",
    );
    expect(invitationState({ expiresAt: future, acceptedAt: null, revokedAt: now }, now)).toBe(
      "revoked",
    );
  });
  test("the exact expiration instant is rejected", () => {
    expect(invitationState({ expiresAt: now, acceptedAt: null, revokedAt: null }, now)).toBe(
      "expired",
    );
  });
});

describe("security management policy boundary", () => {
  test("does not accept a negative idle limit, a stale privileged window or unknown policy keys", () => {
    expect(
      validatePolicy({
        requireMfaForAll: false,
        idleMinutes: -1,
        absoluteHours: 168,
        freshMinutes: 5,
      }).ok,
    ).toBe(false);
    expect(
      validatePolicy({
        requireMfaForAll: false,
        idleMinutes: 30,
        absoluteHours: 168,
        freshMinutes: 60,
      }).ok,
    ).toBe(false);
    expect(
      validatePolicy({
        requireMfaForAll: false,
        idleMinutes: 30,
        absoluteHours: 168,
        freshMinutes: 5,
        publicSignup: true,
      }).ok,
    ).toBe(false);
  });
  test("admits the approved defaults", () => {
    expect(
      validatePolicy({
        requireMfaForAll: false,
        idleMinutes: 30,
        absoluteHours: 168,
        freshMinutes: 5,
      }),
    ).toEqual({
      ok: true,
      value: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 168, freshMinutes: 5 },
    });
  });
});

test("security audit metadata drops arbitrary secrets and credentials even under nested keys", () => {
  expect(
    redactSecurityMetadata({
      reason: "user_requested",
      method: "totp",
      token: "sensitive",
      recoveryCodes: ["secret"],
      context: { password: "secret" },
      count: 2,
    }),
  ).toEqual({ reason: "user_requested", method: "totp", count: 2 });
});
