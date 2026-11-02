import { expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { providerFailureSchema } from "./providers/models";
import { slackRequest } from "./slack";

// Official error/rate-limit references checked 2026-11-01:
// https://docs.slack.dev/reference/methods/auth.test/
// https://docs.slack.dev/reference/methods/conversations.list/
// https://docs.slack.dev/apis/web-api/rate-limits/
// channel_not_found is documented for conversations.info, not these two methods:
// https://docs.slack.dev/reference/methods/conversations.info/
// Its vector covers generic decoder support only, not selected-channel validation.
const token = "synthetic-private-slack-token";

async function failure(response: Response, method = "conversations.list") {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
  const error: unknown = await slackRequest(method, token, {}, fetcher).catch(
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(AppError);
  return error instanceof AppError ? error : undefined;
}

it.each([
  ["token_revoked", "authorization_revoked", "authorization_expired"],
  ["missing_scope", "insufficient_scope", "forbidden"],
  ["channel_not_found", "missing_resource", "invalid_input"],
  ["ratelimited", "rate_limited", "rate_limited"],
  ["service_unavailable", "transient_outage", "unavailable"],
  ["invalid_arguments", "invalid_configuration", "invalid_input"],
])("classifies %s through the existing read request boundary", async (error, reason, code) => {
  const result = await failure(
    Response.json({ ok: false, error, token, needed: "synthetic-private-scope", raw: token }),
  );
  expect(result?.id).toBe(ERROR_IDS.SLACK_REQUEST_FAILED);
  expect(result?.context).toEqual({ slackReadFailure: { reason, providerFailure: { code } } });
  expect(providerFailureSchema.safeParse({ code }).success).toBe(true);
  expect(JSON.stringify(result)).not.toContain(token);
  expect(JSON.stringify(result)).not.toContain("synthetic-private-scope");
});

it("does not infer revoked authorization from invalid_auth or an HTTP denial", async () => {
  // Slack documents invalid_auth as either invalid credentials or disallowed source IP.
  for (const response of [
    Response.json({ ok: false, error: "invalid_auth" }),
    Response.json({ ok: false, error: "access_denied" }, { status: 403 }),
  ]) {
    const result = await failure(response, "auth.test");
    expect(result?.context).toEqual({
      slackReadFailure: { reason: "permission_denied", providerFailure: { code: "forbidden" } },
    });
  }
});

it("normalizes an HTTP rate limit before reading its body", async () => {
  const response = Response.json({ raw: token }, { status: 429, headers: { "Retry-After": "7" } });
  const body = vi.spyOn(response, "json");
  const result = await failure(response);
  expect(body).not.toHaveBeenCalled();
  expect(result?.id).toBe(ERROR_IDS.SLACK_RATE_LIMITED);
  expect(result?.context).toEqual({
    slackReadFailure: {
      reason: "rate_limited",
      providerFailure: { code: "rate_limited", retryAfterMs: 7000 },
    },
  });
});

it.each(["-1", "0", "1.5", "86401", "999999999999999999999", "tomorrow"])(
  "omits invalid or out-of-contract Retry-After %s",
  async (retryAfter) => {
    const result = await failure(
      Response.json({}, { status: 429, headers: { "Retry-After": retryAfter } }),
    );
    expect(result?.context).toEqual({
      slackReadFailure: { reason: "rate_limited", providerFailure: { code: "rate_limited" } },
    });
  },
);

it("classifies a server outage without parsing or exposing the provider body", async () => {
  const response = new Response(token, { status: 503 });
  const body = vi.spyOn(response, "json");
  const result = await failure(response);
  expect(body).not.toHaveBeenCalled();
  expect(result?.id).toBe(ERROR_IDS.SLACK_UNAVAILABLE);
  expect(result?.context).toEqual({
    slackReadFailure: { reason: "transient_outage", providerFailure: { code: "unavailable" } },
  });
});

it.each([{}, { ok: "false" }, { ok: false, error: token.repeat(100) }])(
  "redacts malformed provider envelopes",
  async (body) => {
    const result = await failure(Response.json(body));
    expect(result?.context).toEqual({
      slackReadFailure: {
        reason: "invalid_response",
        providerFailure: { code: "invalid_response" },
      },
    });
    expect(JSON.stringify(result)).not.toContain(token);
  },
);

it("redacts unreadable JSON instead of propagating its parser error", async () => {
  const result = await failure(new Response(token));
  expect(result?.id).toBe(ERROR_IDS.SLACK_REQUEST_FAILED);
  expect(result?.context).toEqual({
    slackReadFailure: { reason: "invalid_response", providerFailure: { code: "invalid_response" } },
  });
  expect(JSON.stringify(result)).not.toContain(token);
});

it("uses a finite unknown classification without copying an unrecognized provider error", async () => {
  const result = await failure(Response.json({ ok: false, error: token, details: token }));
  expect(result?.context).toEqual({
    slackReadFailure: { reason: "unclassified", providerFailure: { code: "failed" } },
  });
  expect(JSON.stringify(result)).not.toContain(token);
});

it("redacts a fetch rejection at the existing read boundary", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue({ message: token, cause: { token } });
  const result: unknown = await slackRequest("auth.test", token, {}, fetcher).catch(
    (cause: unknown) => cause,
  );
  expect(result).toBeInstanceOf(AppError);
  expect(result).toMatchObject({
    id: ERROR_IDS.SLACK_UNAVAILABLE,
    context: {
      slackReadFailure: { reason: "transient_outage", providerFailure: { code: "unavailable" } },
    },
  });
  expect(JSON.stringify(result)).not.toContain(token);
});

it("preserves read successes and revoke's existing already-invalid success", async () => {
  expect(
    await slackRequest(
      "auth.test",
      token,
      {},
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true, team_id: "TSYNTHETIC" })),
    ),
  ).toEqual({ ok: true, team_id: "TSYNTHETIC" });
  expect(
    await slackRequest(
      "auth.revoke",
      token,
      {},
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: false, error: "token_revoked" })),
    ),
  ).toEqual({ ok: true });
});

it("does not apply read classifications or no-effect claims to a mutating request", async () => {
  const result = await failure(
    Response.json({ ok: false, error: "internal_error" }),
    "chat.postMessage",
  );
  expect(result?.id).toBe(ERROR_IDS.SLACK_REQUEST_FAILED);
  expect(result?.context).toEqual({});
});
