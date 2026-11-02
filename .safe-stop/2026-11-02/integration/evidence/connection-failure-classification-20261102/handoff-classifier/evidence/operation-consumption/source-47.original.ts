import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { type ProviderFailure, providerFailureSchema } from "./providers/models";
import { exchangeSlackCode, slackRequest } from "./slack";

type Operation = "send" | "exchange" | "revoke";
type Detail = { reason: string; providerFailure: ProviderFailure };
const operations = ["send", "exchange", "revoke"] as const;
const targets: Record<Operation, string> = {
  send: "https://slack.com/api/chat.postMessage",
  exchange: "https://slack.com/api/oauth.v2.access",
  revoke: "https://slack.com/api/auth.revoke",
};
const token = "synthetic-operation-private-token";
const clientSecret = "synthetic-operation-private-client-secret";
const code = "synthetic-operation-private-code";
const payload = "synthetic-operation-private-message";
const rawDetail = "synthetic-operation-private-provider-detail";
const privateValues = [token, clientSecret, code, payload, rawDetail];

function invoke(operation: Operation, fetcher: typeof fetch) {
  if (operation === "exchange") {
    return exchangeSlackCode(
      code,
      "https://client.example.test/slack/callback",
      {
        clientId: "synthetic-operation-client",
        clientSecret,
      },
      fetcher,
    );
  }
  return slackRequest(
    operation === "send" ? "chat.postMessage" : "auth.revoke",
    token,
    operation === "send" ? { channel: "C_SYNTHETIC", text: payload } : undefined,
    fetcher,
  );
}

function legacy(operation: Operation, kind: "json" | "unavailable" | "rate" = "json") {
  if (operation === "exchange")
    return { id: ERROR_IDS.SLACK_EXCHANGE_FAILED, message: "slack_exchange_failed" };
  if (kind === "unavailable")
    return { id: ERROR_IDS.SLACK_UNAVAILABLE, message: "slack_unavailable" };
  if (kind === "rate") return { id: ERROR_IDS.SLACK_RATE_LIMITED, message: "slack_unavailable" };
  return { id: ERROR_IDS.SLACK_REQUEST_FAILED, message: "slack_request_failed" };
}

function providerError(error: string) {
  return Response.json({ ok: false, error, token, client_secret: clientSecret, detail: rawDetail });
}

function unreadBody(status: number, headers?: HeadersInit) {
  const response = new Response(rawDetail, { status, headers });
  let bodyReads = 0;
  response.json = () => {
    bodyReads++;
    return Promise.resolve({ raw: rawDetail, token });
  };
  return { response, bodyReads: () => bodyReads };
}

async function expectFailure(
  operation: Operation,
  handler: () => Promise<Response>,
  detail: Detail,
  expectedLegacy: { id: string; message: string } = legacy(operation),
) {
  const requests: { target: string; method: string | undefined }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    requests.push({
      target: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method,
    });
    return handler();
  };
  const [outcome] = await Promise.allSettled([invoke(operation, fetcher)]);
  assert(outcome !== undefined);
  expect(requests.length).toBe(1);
  expect(requests[0]?.target === targets[operation] && requests[0].method === "POST").toBe(true);
  expect(outcome.status === "rejected").toBe(true);
  assert(outcome.status === "rejected");
  const failure: unknown = outcome.reason;
  // Boolean assertions avoid printing deliberately hostile transport/body material on RED.
  expect(failure instanceof AppError).toBe(true);
  assert(failure instanceof AppError);
  const cause = "cause" in failure ? failure.cause : undefined;
  const diagnostic = JSON.stringify({
    id: failure.id,
    message: failure.message,
    context: failure.context,
    cause,
    causeMessage: cause instanceof Error ? cause.message : undefined,
  });
  expect(privateValues.every((value) => !diagnostic.includes(value))).toBe(true);
  expect(failure.id).toBe(expectedLegacy.id);
  expect(failure.message).toBe(expectedLegacy.message);
  expect(failure.context).toEqual({ slackOperationFailure: detail });
  const normalized = failure.context?.slackOperationFailure;
  assert(typeof normalized === "object" && normalized !== null && "providerFailure" in normalized);
  expect(providerFailureSchema.safeParse(normalized.providerFailure).success).toBe(true);
}

const rejections: {
  name: string;
  operation: Operation;
  error: string;
  reason: string;
  code: ProviderFailure["code"];
}[] = [
  {
    name: "send revoked authorization",
    operation: "send",
    error: "token_revoked",
    reason: "authorization_revoked",
    code: "authorization_expired",
  },
  {
    name: "send insufficient scope",
    operation: "send",
    error: "missing_scope",
    reason: "insufficient_scope",
    code: "forbidden",
  },
  {
    name: "send unavailable selected resource",
    operation: "send",
    error: "channel_not_found",
    reason: "missing_resource",
    code: "invalid_input",
  },
  {
    name: "exchange invalid client configuration",
    operation: "exchange",
    error: "bad_client_secret",
    reason: "invalid_configuration",
    code: "invalid_input",
  },
  {
    name: "revoke ambiguous authentication is not proved revocation",
    operation: "revoke",
    error: "invalid_auth",
    reason: "permission_denied",
    code: "forbidden",
  },
];
test.each(rejections)("$name", async ({ operation, error, reason, code: failureCode }) => {
  await expectFailure(operation, () => Promise.resolve(providerError(error)), {
    reason,
    providerFailure: { code: failureCode },
  });
});

const retryHints = [
  ["7", 7_000],
  ["86400", 86_400_000],
  ["86401", undefined],
  ["0", undefined],
  ["tomorrow", undefined],
] as const;
test.each(
  operations.flatMap((operation) =>
    retryHints.map(([raw, milliseconds]) => ({ operation, raw, milliseconds })),
  ),
)(
  '$operation HTTP429 Retry-After "$raw" retains only a bounded hint without reading the body',
  async ({ operation, raw, milliseconds }) => {
    const fixture = unreadBody(429, { "Retry-After": raw });
    await expectFailure(
      operation,
      () => Promise.resolve(fixture.response),
      {
        reason: "rate_limited",
        providerFailure: {
          code: "rate_limited",
          ...(milliseconds === undefined ? {} : { retryAfterMs: milliseconds }),
        },
      },
      legacy(operation, "rate"),
    );
    expect(fixture.bodyReads()).toBe(0);
  },
);

const outageModes = ["internal_error", "fatal_error", "HTTP503", "transport failure"] as const;
test.each(operations.flatMap((operation) => outageModes.map((mode) => ({ operation, mode }))))(
  "$operation $mode retains unknown effects and a redacted transient classification",
  async ({ operation, mode }) => {
    const outage = unreadBody(503);
    const partial = mode === "internal_error" || mode === "fatal_error";
    const handler =
      mode === "transport failure"
        ? () =>
            Promise.reject({
              message: rawDetail,
              headers: { authorization: token },
              body: payload,
            })
        : mode === "HTTP503"
          ? () => Promise.resolve(outage.response)
          : () => Promise.resolve(providerError(mode));
    await expectFailure(
      operation,
      handler,
      {
        reason: "transient_outage",
        providerFailure: { code: "unavailable", outcome: "unknown" },
      },
      legacy(operation, partial ? "json" : "unavailable"),
    );
    expect(outage.bodyReads()).toBe(0);
  },
);

const fallbacks = [
  {
    name: "unknown provider error",
    createResponse: () => providerError(token),
    reason: "unclassified",
    code: "failed",
  },
  {
    name: "provider request_timeout",
    createResponse: () => providerError("request_timeout"),
    reason: "unclassified",
    code: "failed",
  },
  {
    name: "malformed response shape",
    createResponse: () => Response.json({ ok: "false", raw: rawDetail, token }),
    reason: "invalid_response",
    code: "invalid_response",
  },
  {
    name: "unreadable JSON response",
    createResponse: () => new Response(rawDetail),
    reason: "invalid_response",
    code: "invalid_response",
  },
] as const;
test.each(operations.flatMap((operation) => fallbacks.map((item) => ({ operation, ...item }))))(
  "$operation $name preserves a finite reason and unknown effects",
  async ({ operation, createResponse, reason, code: failureCode }) => {
    await expectFailure(operation, () => Promise.resolve(createResponse()), {
      reason,
      providerFailure: { code: failureCode, outcome: "unknown" },
    });
  },
);

test("exchange unusable successful candidate retains insufficient scope and unknown effects", async () => {
  // An unusable successful candidate may already have created a remote token.
  await expectFailure(
    "exchange",
    () =>
      Promise.resolve(
        Response.json({
          ok: true,
          access_token: token,
          scope: "channels:read",
          team: { id: "T_SYNTHETIC", name: "Synthetic workspace" },
        }),
      ),
    {
      reason: "insufficient_scope",
      providerFailure: { code: "invalid_response", outcome: "unknown" },
    },
    { id: ERROR_IDS.SLACK_SCOPE_MISSING, message: "slack_scope_missing" },
  );
});

test.each([
  {
    name: "already token_revoked",
    response: { ok: false, error: "token_revoked" },
    expected: { ok: true },
  },
  {
    name: "explicit revoked:true",
    response: { ok: true, revoked: true },
    expected: { ok: true, revoked: true },
  },
])("revoke $name retains existing success", async ({ response, expected }) => {
  let calls = 0;
  const fetcher: typeof fetch = (input, init) => {
    calls++;
    expect(input === targets.revoke && init?.method === "POST").toBe(true);
    return Promise.resolve(Response.json(response));
  };
  expect(await invoke("revoke", fetcher)).toEqual(expected);
  expect(calls).toBe(1);
});
