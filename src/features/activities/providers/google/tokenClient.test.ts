import { describe, expect, it, vi } from "vitest";
import type { CalendarOAuthConfig } from "./authorizationConfig";
import { exchangeCalendarCode, fetchCalendarIdentity, refreshCalendarToken } from "./tokenClient";

const config: CalendarOAuthConfig = {
  clientId: "client",
  clientSecret: "client-secret",
  redirectUri: "https://crm.example.invalid/api/calendar/google/callback",
  access: "readWrite",
};
const signal = () => AbortSignal.timeout(5000);
const scope =
  "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events";
const response = () =>
  new Response(
    JSON.stringify({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      token_type: "Bearer",
      scope,
    }),
  );
function formBody(init: RequestInit): URLSearchParams {
  expect(typeof init.body).toBe("string");
  return new URLSearchParams(typeof init.body === "string" ? init.body : "");
}

it("exchanges an authorization code with client secret and the same PKCE verifier", async () => {
  const transport = vi.fn().mockResolvedValue(response());
  const r = await exchangeCalendarCode(
    config,
    { code: "single-use-code", codeVerifier: "a".repeat(43), signal: signal() },
    transport,
  );
  expect(r).toEqual({
    ok: true,
    value: {
      accessToken: "access",
      refreshToken: "refresh",
      expiresIn: 3600,
      grantedScopes: scope.split(" "),
    },
  });
  expect(transport.mock.calls[0]?.[0]).toBe("https://oauth2.googleapis.com/token");
  const init = transport.mock.calls[0]?.[1] as RequestInit;
  const body = formBody(init);
  expect(body.get("grant_type")).toBe("authorization_code");
  expect(body.get("client_secret")).toBe("client-secret");
  expect(body.get("code_verifier")).toBe("a".repeat(43));
  expect(body.get("redirect_uri")).toBe(config.redirectUri);
  expect(init.signal).toBeDefined();
  expect(body.toString()).not.toContain("gmail");
});
it("rejects missing Calendar consent even if sign-in or Gmail scopes were granted", async () => {
  const transport = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        access_token: "access",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email https://www.googleapis.com/auth/gmail.modify",
      }),
    ),
  );
  expect(
    await exchangeCalendarCode(
      config,
      { code: "code", codeVerifier: "a".repeat(43), signal: signal() },
      transport,
    ),
  ).toEqual({ ok: false, error: { kind: "missing_scope" } });
});
it("refreshes without requiring a new refresh token or scope string, and accepts rotation when returned", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ access_token: "next", expires_in: 3600, token_type: "Bearer" }),
      ),
    )
    .mockResolvedValueOnce(response());
  expect(
    await refreshCalendarToken(config, { refreshToken: "old", signal: signal() }, transport),
  ).toEqual({ ok: true, value: { accessToken: "next", expiresIn: 3600 } });
  expect(
    (await refreshCalendarToken(config, { refreshToken: "old", signal: signal() }, transport)).ok,
  ).toBe(true);
  const body = formBody((transport.mock.calls[0]?.[1] ?? {}) as RequestInit);
  expect(body.get("grant_type")).toBe("refresh_token");
  expect(body.get("refresh_token")).toBe("old");
});
it("fetches validated stable identity without trusting a callback email", async () => {
  const transport = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        sub: "google-sub",
        email: "USER@EXAMPLE.COM",
        email_verified: true,
        hd: "example.com",
      }),
    ),
  );
  expect(await fetchCalendarIdentity("access", signal(), transport)).toEqual({
    ok: true,
    value: { subject: "google-sub", emailAddress: "user@example.com", hostedDomain: "example.com" },
  });
  expect(transport.mock.calls[0]?.[0]).toBe("https://openidconnect.googleapis.com/v1/userinfo");
  expect(((transport.mock.calls[0]?.[1] ?? {}) as RequestInit).headers).toEqual({
    Authorization: "Bearer access",
  });
});
it.each([false, "true", undefined])(
  "rejects unverified/malformed identity flag %s",
  async (email_verified) => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ sub: "sub", email: "user@example.com", email_verified })),
      );
    expect(await fetchCalendarIdentity("access", signal(), transport)).toEqual({
      ok: false,
      error: { kind: "identity_unverified" },
    });
  },
);
describe("operational token failures", () => {
  it("distinguishes invalid_grant from provider/network failures without returning provider messages", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "private token details" }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(new Response("private error", { status: 503 }))
      .mockRejectedValueOnce(new TypeError("private network detail"));
    expect(
      await refreshCalendarToken(config, { refreshToken: "secret", signal: signal() }, transport),
    ).toEqual({ ok: false, error: { kind: "unauthorized", status: 400 } });
    expect(
      await refreshCalendarToken(config, { refreshToken: "secret", signal: signal() }, transport),
    ).toEqual({ ok: false, error: { kind: "provider_unavailable", status: 503 } });
    expect(
      await refreshCalendarToken(config, { refreshToken: "secret", signal: signal() }, transport),
    ).toEqual({ ok: false, error: { kind: "network" } });
  });
  it("rejects malformed JSON/token responses without throwing", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(new Response("broken"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "", expires_in: -1 })));
    expect(
      await refreshCalendarToken(config, { refreshToken: "secret", signal: signal() }, transport),
    ).toEqual({ ok: false, error: { kind: "invalid_response" } });
    expect(
      await refreshCalendarToken(config, { refreshToken: "secret", signal: signal() }, transport),
    ).toEqual({ ok: false, error: { kind: "invalid_response" } });
  });
  it("propagates cancellation and does not perform HTTP for invalid inputs", async () => {
    const transport = vi.fn().mockResolvedValue(response());
    expect(
      await exchangeCalendarCode(
        config,
        { code: "", codeVerifier: "bad", signal: signal() },
        transport,
      ),
    ).toEqual({ ok: false, error: { kind: "invalid_input" } });
    expect(transport).not.toHaveBeenCalled();
    const abort = new AbortController();
    abort.abort();
    await expect(
      refreshCalendarToken(config, { refreshToken: "secret", signal: abort.signal }, transport),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

it("forbids redirecting client credentials or bearer tokens outside their fixed Google endpoints", async () => {
  const transport = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ sub: "subject", email: "user@example.com", email_verified: true }),
      ),
    );
  await exchangeCalendarCode(
    config,
    { code: "code", codeVerifier: "a".repeat(43), signal: signal() },
    transport,
  );
  await fetchCalendarIdentity("access", signal(), transport);
  expect(transport.mock.calls.map((call) => (call[1] as RequestInit).redirect)).toEqual([
    "error",
    "error",
  ]);
});
