import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildCalendarAuthorizationUrl,
  createCalendarAuthorizationMaterial,
  validateCalendarIdentity,
} from "./authorization";
import type { CalendarOAuthConfig } from "./authorizationConfig";

const config: CalendarOAuthConfig = {
  clientId: "calendar-client",
  clientSecret: "private-client-secret",
  redirectUri: "https://crm.example.invalid/api/calendar/google/callback",
  access: "readWrite",
};

describe("Calendar authorization boundary", () => {
  it("creates independent opaque state/browser secrets and S256 proof without embedding user identity", () => {
    const a = createCalendarAuthorizationMaterial();
    const b = createCalendarAuthorizationMaterial();
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.browserNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      new Set([a.state, a.browserNonce, a.codeVerifier, b.state, b.browserNonce, b.codeVerifier])
        .size,
    ).toBe(6);
    expect(a.stateHash).toBe(createHash("sha256").update(a.state).digest("hex"));
    expect(a.browserBindingHash).toBe(createHash("sha256").update(a.browserNonce).digest("hex"));
    expect(a.codeChallenge).toBe(createHash("sha256").update(a.codeVerifier).digest("base64url"));
  });
  it("requests a separate offline Calendar grant with explicit PKCE and no Gmail/login token reuse", () => {
    const material = createCalendarAuthorizationMaterial();
    const result = buildCalendarAuthorizationUrl(config, material);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.value);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(material.codeChallenge);
    expect(url.searchParams.get("state")).toBe(material.state);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(result.value).not.toContain(config.clientSecret);
    expect(result.value).not.toContain(material.codeVerifier);
    expect(result.value).not.toContain("gmail");
  });
  it("offers read-only event consent without requesting write authority", () => {
    const r = buildCalendarAuthorizationUrl(
      { ...config, access: "readOnly" },
      createCalendarAuthorizationMaterial(),
    );
    expect(r.ok && new URL(r.value).searchParams.get("scope")).toContain(
      "calendar.events.readonly",
    );
  });
  it.each([
    "http://public.example/callback",
    "https://user:secret@example.com/callback",
    "https://example.com/callback#token",
  ])("rejects unsafe configured redirect %s", (redirectUri) => {
    expect(
      buildCalendarAuthorizationUrl(
        { ...config, redirectUri },
        createCalendarAuthorizationMaterial(),
      ),
    ).toEqual({ ok: false, error: { kind: "configuration" } });
  });
  it("accepts an explicit loopback callback for local provider setup", () => {
    expect(
      buildCalendarAuthorizationUrl(
        { ...config, redirectUri: "http://127.0.0.1:3169/api/calendar/google/callback" },
        createCalendarAuthorizationMaterial(),
      ).ok,
    ).toBe(true);
  });
  it("allows an explicitly chosen verified external account while binding reconnection to stable subject", () => {
    const identity = {
      subject: "external-sub",
      emailAddress: "External@Example.COM",
      hostedDomain: null,
    };
    expect(validateCalendarIdentity(identity, { workspaceEmail: "owner@crm.invalid" })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      validateCalendarIdentity(identity, {
        workspaceEmail: "owner@crm.invalid",
        expectedSubject: "other-sub",
      }),
    ).toEqual({ ok: false, error: { kind: "identity_mismatch" } });
    expect(
      validateCalendarIdentity(identity, {
        workspaceEmail: "owner@crm.invalid",
        requireSameEmail: true,
      }),
    ).toEqual({ ok: false, error: { kind: "identity_mismatch" } });
  });
  it("enforces a configured hosted-domain policy using hd, never an email suffix", () => {
    expect(
      validateCalendarIdentity(
        { subject: "sub", emailAddress: "user@allowed.test", hostedDomain: null },
        { workspaceEmail: "owner@crm.invalid", allowedDomain: "allowed.test" },
      ).ok,
    ).toBe(false);
    expect(
      validateCalendarIdentity(
        { subject: "sub", emailAddress: "user@allowed.test", hostedDomain: "allowed.test" },
        { workspaceEmail: "owner@crm.invalid", allowedDomain: "allowed.test" },
      ).ok,
    ).toBe(true);
  });
});
