import assert from "node:assert/strict";
import { afterEach, expect, test, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { listSlackChannels } from "./slack";

const token = "synthetic-channel-response-private-token";
const rawDetail = "synthetic-channel-response-private-provider-detail";
const privateValues = [token, rawDetail];
const expectedContext = {
  slackReadFailure: {
    reason: "invalid_response",
    providerFailure: { code: "invalid_response" },
  },
};

function controlledResponse(body: unknown) {
  let calls = 0;
  const fetcher: typeof fetch = (input, init) => {
    calls++;
    const target =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    expect(target === "https://slack.com/api/conversations.list").toBe(true);
    expect(init?.method === "POST").toBe(true);
    expect(new Headers(init?.headers).get("authorization") === `Bearer ${token}`).toBe(true);
    init?.signal?.throwIfAborted();
    return Promise.resolve(Response.json(body));
  };
  vi.stubGlobal("fetch", fetcher);
  return () => calls;
}

async function expectInvalidChannelResponse(body: unknown) {
  const calls = controlledResponse(body);
  const [outcome] = await Promise.allSettled([listSlackChannels(token)]);
  expect(calls()).toBe(1);
  assert(outcome !== undefined);
  expect(outcome.status === "rejected").toBe(true);
  assert(outcome.status === "rejected");
  const failure: unknown = outcome.reason;
  // Boolean assertions keep hostile provider/credential fixtures out of RED diagnostics.
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
  expect(cause === undefined).toBe(true);
  expect(failure.id).toBe(ERROR_IDS.SLACK_REQUEST_FAILED);
  expect(failure.message).toBe("slack_request_failed");
  expect(failure.context).toEqual(expectedContext);
  expect(failure.context).not.toHaveProperty("slackOperationFailure");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("redacts a successful channel response missing its channels list", async () => {
  await expectInvalidChannelResponse({ ok: true, access_token: token, raw: rawDetail });
});

test("redacts a malformed channel item behind a successful response", async () => {
  await expectInvalidChannelResponse({
    ok: true,
    channels: [{ id: "CSYNTHETIC", name: { raw: rawDetail }, is_member: true }],
    access_token: token,
    raw: rawDetail,
  });
});

test("returns member channels from one valid page without an extra request", async () => {
  const calls = controlledResponse({
    ok: true,
    channels: [
      { id: "CMEMBER", name: "Synthetic member channel", is_member: true },
      { id: "COTHER", name: "Synthetic nonmember channel", is_member: false },
    ],
    response_metadata: { next_cursor: "" },
  });
  expect(await listSlackChannels(token)).toEqual([
    { id: "CMEMBER", name: "Synthetic member channel" },
  ]);
  expect(calls()).toBe(1);
});
