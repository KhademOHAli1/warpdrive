import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS, type ErrorId } from "@/constants/errorIds";
import {
  classifySlackOperationError,
  classifySlackOperationHttpFailure,
  type SlackOperationFailure,
  slackOperationFailure,
} from "./slackOperationFailure";
import { requestSlackRead } from "./slackRead";

export const SLACK_SCOPES = ["chat:write", "channels:read"] as const;
const responseFailure = z.object({ ok: z.literal(false), error: z.string().max(128).optional() });
const responseBase = z.union([z.object({ ok: z.literal(true) }), responseFailure]);
const revocationResponse = z.union([
  z.object({ ok: z.literal(true), revoked: z.literal(true) }),
  responseFailure,
]);
const exchangeResponse = z.union([
  z.object({
    ok: z.literal(true),
    access_token: z.string().min(1),
    scope: z.string(),
    team: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  }),
  responseFailure,
]);

function operationError(id: ErrorId, message: string, detail: SlackOperationFailure) {
  return new AppError(id, message, { slackOperationFailure: detail });
}

function mutationBodyError(signal: AbortSignal) {
  if (signal.aborted)
    return operationError(
      ERROR_IDS.SLACK_UNAVAILABLE,
      "slack_unavailable",
      slackOperationFailure("transient_outage", "unavailable", "unknown"),
    );
  return operationError(
    ERROR_IDS.SLACK_REQUEST_FAILED,
    "slack_request_failed",
    slackOperationFailure("invalid_response", "invalid_response", "unknown"),
  );
}

export function slackConfiguration() {
  const clientId = env.SLACK_CLIENT_ID;
  const clientSecret = env.SLACK_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function slackAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: SLACK_SCOPES.join(","),
  }).toString();
  return url.toString();
}

export async function slackRequest(
  method: string,
  token: string,
  body?: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  // Only fixed, internal method names may reach this boundary. No caller-supplied URLs.
  if (!["auth.test", "conversations.list", "chat.postMessage", "auth.revoke"].includes(method))
    throw new AppError(ERROR_IDS.SLACK_METHOD_INVALID, "slack_method_invalid", {});
  if (method === "auth.test" || method === "conversations.list") {
    const read = await requestSlackRead({
      method,
      token,
      body,
      fetcher,
      signal: new AbortController().signal,
    });
    if (read.ok) return read.value;
    const { legacyErrorId, ...slackReadFailure } = read.error;
    throw new AppError(
      legacyErrorId,
      legacyErrorId === ERROR_IDS.SLACK_REQUEST_FAILED
        ? "slack_request_failed"
        : "slack_unavailable",
      { slackReadFailure },
    );
  }
  return requestSlackMutation(method, token, body, fetcher, AbortSignal.timeout(10_000));
}

async function requestSlackMutation(
  method: string,
  token: string,
  body: Record<string, string> | undefined,
  fetcher: typeof fetch,
  signal: AbortSignal,
) {
  let response: Response;
  try {
    response = await fetcher(`https://slack.com/api/${method}`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body ?? {}),
    });
  } catch {
    throw operationError(
      ERROR_IDS.SLACK_UNAVAILABLE,
      "slack_unavailable",
      slackOperationFailure("transient_outage", "unavailable", "unknown"),
    );
  }
  if (!response.ok)
    throw operationError(
      response.status === 429 ? ERROR_IDS.SLACK_RATE_LIMITED : ERROR_IDS.SLACK_UNAVAILABLE,
      "slack_unavailable",
      classifySlackOperationHttpFailure(response.status, response.headers.get("Retry-After")),
    );
  let data: unknown;
  try {
    data = await response.json();
    signal.throwIfAborted();
  } catch {
    throw mutationBodyError(signal);
  }
  const parsed = (method === "auth.revoke" ? revocationResponse : responseBase).safeParse(data);
  if (!parsed.success)
    throw operationError(
      ERROR_IDS.SLACK_REQUEST_FAILED,
      "slack_request_failed",
      slackOperationFailure("invalid_response", "invalid_response", "unknown"),
    );
  if (!parsed.data.ok) {
    // Ambiguous authentication failures do not prove revocation, so retain retry material.
    if (
      method === "auth.revoke" &&
      ["token_revoked", "token_expired", "account_inactive"].includes(parsed.data.error ?? "")
    )
      return { ok: true };
    throw operationError(
      ERROR_IDS.SLACK_REQUEST_FAILED,
      "slack_request_failed",
      classifySlackOperationError(parsed.data.error),
    );
  }
  return data;
}

export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
  config: { clientId: string; clientSecret: string },
  fetcher: typeof fetch = fetch,
) {
  const signal = AbortSignal.timeout(10_000);
  let response: Response;
  try {
    response = await fetcher("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
  } catch {
    throw operationError(
      ERROR_IDS.SLACK_EXCHANGE_FAILED,
      "slack_exchange_failed",
      slackOperationFailure("transient_outage", "unavailable", "unknown"),
    );
  }
  if (!response.ok)
    throw operationError(
      ERROR_IDS.SLACK_EXCHANGE_FAILED,
      "slack_exchange_failed",
      classifySlackOperationHttpFailure(response.status, response.headers.get("Retry-After")),
    );
  let data: unknown;
  try {
    data = await response.json();
    signal.throwIfAborted();
  } catch {
    throw operationError(
      ERROR_IDS.SLACK_EXCHANGE_FAILED,
      "slack_exchange_failed",
      signal.aborted
        ? slackOperationFailure("transient_outage", "unavailable", "unknown")
        : slackOperationFailure("invalid_response", "invalid_response", "unknown"),
    );
  }
  const parsed = exchangeResponse.safeParse(data);
  if (!parsed.success)
    throw operationError(
      ERROR_IDS.SLACK_EXCHANGE_FAILED,
      "slack_exchange_failed",
      slackOperationFailure("invalid_response", "invalid_response", "unknown"),
    );
  if (!parsed.data.ok)
    throw operationError(
      ERROR_IDS.SLACK_EXCHANGE_FAILED,
      "slack_exchange_failed",
      classifySlackOperationError(parsed.data.error),
    );
  const scopes = parsed.data.scope.split(",");
  if (!SLACK_SCOPES.every((scope) => scopes.includes(scope)))
    throw operationError(
      ERROR_IDS.SLACK_SCOPE_MISSING,
      "slack_scope_missing",
      slackOperationFailure("insufficient_scope", "invalid_response", "unknown"),
    );
  return { token: parsed.data.access_token, scopes, team: parsed.data.team };
}

export async function listSlackChannels(token: string) {
  const parsed = z.object({
    channels: z.array(z.object({ id: z.string(), name: z.string(), is_member: z.boolean() })),
    response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
  });
  const channels: { id: string; name: string }[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const data = parsed.parse(
      await slackRequest("conversations.list", token, {
        limit: "200",
        exclude_archived: "true",
        types: "public_channel",
        cursor,
      }),
    );
    channels.push(
      ...data.channels.filter((channel) => channel.is_member).map(({ id, name }) => ({ id, name })),
    );
    cursor = data.response_metadata?.next_cursor ?? "";
    if (!cursor) return channels;
  }
  throw new AppError(ERROR_IDS.SLACK_CHANNEL_LIMIT, "slack_channel_limit", {});
}
