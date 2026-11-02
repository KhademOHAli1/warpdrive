import { expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { slackRequest } from "./slack";

const token = "synthetic-private-revocation-token";

it.each([
  ["ambiguous authentication denial", { ok: false, error: "invalid_auth" }],
  ["explicitly unrevoked response", { ok: true, revoked: false }],
  ["missing revocation confirmation", { ok: true }],
])("keeps %s unresolved instead of reporting remote revocation", async (_name, body) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));

  await expect(slackRequest("auth.revoke", token, undefined, fetcher)).rejects.toMatchObject({
    id: ERROR_IDS.SLACK_REQUEST_FAILED,
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("accepts an explicit successful revocation without changing the request contract", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ok: true, revoked: true }));

  await expect(slackRequest("auth.revoke", token, undefined, fetcher)).resolves.toEqual({
    ok: true,
    revoked: true,
  });
  expect(fetcher).toHaveBeenCalledWith(
    "https://slack.com/api/auth.revoke",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      signal: expect.any(AbortSignal),
      body: expect.any(URLSearchParams),
    }),
  );
});

it.each(["token_revoked", "token_expired", "account_inactive"])(
  "retains idempotent success when Slack explicitly reports %s",
  async (error) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: false, error }));

    await expect(slackRequest("auth.revoke", token, undefined, fetcher)).resolves.toEqual({
      ok: true,
    });
  },
);
