import { expect, it, vi } from "vitest";
import { exchangeSlackCode, slackAuthorizeUrl, slackRequest } from "./slack";

it("requests minimal bot scopes and preserves state and the exact callback", () => {
  const url = new URL(
    slackAuthorizeUrl(
      "client",
      "https://crm.example/api/integrations/slack/callback",
      "random-state",
    ),
  );
  expect(url.origin).toBe("https://slack.com");
  expect(url.searchParams.get("state")).toBe("random-state");
  expect(url.searchParams.get("scope")).toBe("chat:write,channels:read");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://crm.example/api/integrations/slack/callback",
  );
});

it("rejects partial authorization without leaking the returned token in its error", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      ok: true,
      access_token: "private-test-token",
      scope: "channels:read",
      team: { id: "T001", name: "Test" },
    }),
  );
  await expect(
    exchangeSlackCode(
      "code",
      "https://crm.example/callback",
      { clientId: "id", clientSecret: "secret" },
      fetcher,
    ),
  ).rejects.toThrow("slack_scope_missing");
});

it("never follows provider redirects with credentials", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  await slackRequest("auth.test", "private-test-token", {}, fetcher);
  expect(fetcher).toHaveBeenCalledWith(
    "https://slack.com/api/auth.test",
    expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
  );
});

it("rejects a caller-supplied provider method without making a request", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(
    slackRequest("https://malicious.example", "private-test-token", {}, fetcher),
  ).rejects.toThrow("slack_method_invalid");
  expect(fetcher).not.toHaveBeenCalled();
});
