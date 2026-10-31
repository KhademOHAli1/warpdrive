import { afterEach, expect, it, vi } from "vitest";
import { gmailOAuthProvider } from "./oauthProvider";

afterEach(() => vi.unstubAllGlobals());

it("sends the server-held PKCE verifier only to Google's fixed token endpoint and refuses redirects", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "openid email",
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect(await gmailOAuthProvider.exchangeCode("private-code", "private-verifier", signal)).toEqual(
    { ok: true, value: { accessToken: "at", refreshToken: "rt", scopes: ["openid", "email"] } },
  );
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://oauth2.googleapis.com/token");
  expect(init.redirect).toBe("error");
  expect(init.signal).toBe(signal);
  expect(new URLSearchParams(init.body as URLSearchParams).get("code_verifier")).toBe(
    "private-verifier",
  );
  expect(new URLSearchParams(init.body as URLSearchParams).get("code")).toBe("private-code");
});

it.each([
  Response.json({ access_token: "at", expires_in: 3600 }),
  new Response("private-provider-diagnostic", { status: 400 }),
])("rejects invalid token responses without exposing remote bodies", async (response) => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
  const result = await gmailOAuthProvider.exchangeCode(
    "code",
    "verifier",
    new AbortController().signal,
  );
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(
    /private-provider-diagnostic|private-code|private-verifier/,
  );
});
