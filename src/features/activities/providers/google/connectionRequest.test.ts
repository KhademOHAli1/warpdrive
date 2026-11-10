import { afterEach, expect, it, vi } from "vitest";
import { requestGoogleCalendarConnection } from "./connectionRequest";

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
afterEach(() => vi.unstubAllGlobals());
it("accepts only the Google authorization endpoint from a successful response", async () => {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?state=opaque";
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        ok: true,
        data: { authorizationUrl: url, expiresAt: "2026-11-01T12:00:00Z" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const signal = AbortSignal.timeout(1_000);
  expect(await requestGoogleCalendarConnection(signal, "account")).toEqual({
    ok: true,
    value: url,
  });
  expect(fetcher).toHaveBeenCalledWith(
    "/api/calendar/google/oauth/start",
    expect.objectContaining({ signal, body: '{"accountId":"account"}' }),
  );
});
it.each([
  "https://attacker.invalid/o/oauth2/v2/auth",
  "https://accounts.google.com.attacker.invalid/o/oauth2/v2/auth",
  "https://accounts.google.com/o/oauth2/v2/auth#private",
  "https://user:password@accounts.google.com/o/oauth2/v2/auth",
  "https://accounts.google.com/other",
  "javascript:alert(1)",
])("fails closed on an unexpected authorization destination %s", async (url) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: { authorizationUrl: url } })),
      ),
  );
  expect(await requestGoogleCalendarConnection(AbortSignal.timeout(1_000))).toEqual({
    ok: false,
    error: "unavailable",
  });
});
it("does not expose malformed JSON, provider details or network exceptions", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("private invalid response"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: "private-error" }), { status: 400 }),
    )
    .mockRejectedValueOnce(new TypeError("private network details"));
  vi.stubGlobal("fetch", fetcher);
  for (let index = 0; index < 3; index++)
    expect(await requestGoogleCalendarConnection(AbortSignal.timeout(1_000))).toEqual({
      ok: false,
      error: "unavailable",
    });
});
it("preserves cancellation instead of converting it to a provider failure", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  controller.abort();
  await expect(requestGoogleCalendarConnection(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetcher).not.toHaveBeenCalled();
});
