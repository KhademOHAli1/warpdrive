import type { ProviderFailure } from "./providers/models";
import type { SlackReadFailureReason } from "./slackReadFailure";

export interface SlackOperationFailure {
  reason: SlackReadFailureReason;
  providerFailure: ProviderFailure;
}

const MAX_RETRY_AFTER_SECONDS = 86_400;

function retryDelay(raw: string | null): number | undefined {
  if (raw === null || !/^[0-9]{1,5}$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return seconds >= 1 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds * 1000 : undefined;
}

export function slackOperationFailure(
  reason: SlackReadFailureReason,
  code: ProviderFailure["code"],
  outcome?: "unknown",
  retryAfter: string | null = null,
): SlackOperationFailure {
  const providerFailure: ProviderFailure = { code };
  if (outcome === "unknown") providerFailure.outcome = "unknown";
  if (code === "rate_limited") {
    const retryAfterMs = retryDelay(retryAfter);
    if (retryAfterMs !== undefined) providerFailure.retryAfterMs = retryAfterMs;
  }
  return { reason, providerFailure };
}

export function classifySlackOperationError(error: string | undefined): SlackOperationFailure {
  switch (error) {
    case "token_revoked":
    case "account_inactive":
      return slackOperationFailure("authorization_revoked", "authorization_expired");
    case "token_expired":
      return slackOperationFailure("authorization_expired", "authorization_expired");
    case "missing_scope":
      return slackOperationFailure("insufficient_scope", "forbidden");
    case "channel_not_found":
      return slackOperationFailure("missing_resource", "invalid_input");
    case "bad_client_secret":
      return slackOperationFailure("invalid_configuration", "invalid_input");
    case "invalid_auth":
      return slackOperationFailure("permission_denied", "forbidden");
    case "internal_error":
    case "fatal_error":
    case "service_unavailable":
      // These errors can follow partial mutation, so they cannot authorize a safe replay.
      return slackOperationFailure("transient_outage", "unavailable", "unknown");
    default:
      return slackOperationFailure("unclassified", "failed", "unknown");
  }
}

export function classifySlackOperationHttpFailure(
  status: number,
  retryAfter: string | null,
): SlackOperationFailure {
  if (status === 429)
    return slackOperationFailure("rate_limited", "rate_limited", undefined, retryAfter);
  if (status >= 500 && status < 600)
    return slackOperationFailure("transient_outage", "unavailable", "unknown");
  return slackOperationFailure("unclassified", "failed", "unknown");
}
