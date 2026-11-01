import { z } from "zod";
import type { ERROR_IDS } from "@/constants/errorIds";
import { err, ok, type Result } from "@/types/result";
import type { ProviderFailure } from "./providers/models";

export type SlackReadFailureReason =
  | "authorization_revoked"
  | "authorization_expired"
  | "insufficient_scope"
  | "missing_resource"
  | "rate_limited"
  | "transient_outage"
  | "invalid_configuration"
  | "permission_denied"
  | "invalid_response"
  | "unclassified";
type LegacyErrorId = (typeof ERROR_IDS)[
  | "SLACK_REQUEST_FAILED"
  | "SLACK_RATE_LIMITED"
  | "SLACK_UNAVAILABLE"];
export interface SlackReadFailure {
  reason: SlackReadFailureReason;
  providerFailure: ProviderFailure;
  legacyErrorId: LegacyErrorId;
}

const envelope = z.object({ ok: z.boolean(), error: z.string().max(128).optional() });
const MAX_RETRY_AFTER_SECONDS = 86_400;
type Classification = readonly [SlackReadFailureReason, ProviderFailure["code"]];

// Official Slack method/error and rate-limit references checked 2026-11-01:
// https://docs.slack.dev/reference/methods/auth.test/
// https://docs.slack.dev/reference/methods/conversations.list/
// https://docs.slack.dev/apis/web-api/rate-limits/
const classifications = new Map<string, Classification>([
  ["token_revoked", ["authorization_revoked", "authorization_expired"]],
  ["account_inactive", ["authorization_revoked", "authorization_expired"]],
  ["token_expired", ["authorization_expired", "authorization_expired"]],
  ["missing_scope", ["insufficient_scope", "forbidden"]],
  // Decoder support only: neither current read method validates a selected channel.
  // https://docs.slack.dev/reference/methods/conversations.info/
  ["channel_not_found", ["missing_resource", "invalid_input"]],
  ["ratelimited", ["rate_limited", "rate_limited"]],
  ["service_unavailable", ["transient_outage", "unavailable"]],
  ["internal_error", ["transient_outage", "unavailable"]],
  ["fatal_error", ["transient_outage", "unavailable"]],
  ["invalid_arguments", ["invalid_configuration", "invalid_input"]],
  ["invalid_cursor", ["invalid_configuration", "invalid_input"]],
  ["not_allowed_token_type", ["invalid_configuration", "invalid_input"]],
  // invalid_auth can also mean IP-policy denial; it is not proof of revocation.
  ["invalid_auth", ["permission_denied", "forbidden"]],
  ["access_denied", ["permission_denied", "forbidden"]],
  ["no_permission", ["permission_denied", "forbidden"]],
  ["team_access_not_granted", ["permission_denied", "forbidden"]],
]);

function retryDelay(raw: string | null): number | undefined {
  if (raw === null || !/^[0-9]{1,5}$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return seconds >= 1 && seconds <= MAX_RETRY_AFTER_SECONDS ? seconds * 1000 : undefined;
}

export function slackReadFailure(
  reason: SlackReadFailureReason,
  code: ProviderFailure["code"],
  legacyErrorId: LegacyErrorId,
  retryAfter: string | null = null,
): SlackReadFailure {
  const retryAfterMs = code === "rate_limited" ? retryDelay(retryAfter) : undefined;
  return {
    reason,
    providerFailure: { code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
    legacyErrorId,
  };
}

export function decodeSlackReadResponse(args: {
  data: unknown;
  httpOk: boolean;
  legacyErrorId: LegacyErrorId;
  retryAfter: string | null;
}): Result<unknown, SlackReadFailure> {
  const parsed = envelope.safeParse(args.data);
  if (!parsed.success)
    return err(slackReadFailure("invalid_response", "invalid_response", args.legacyErrorId));
  if (args.httpOk && parsed.data.ok) return ok(args.data);
  const [reason, code] = classifications.get(parsed.data.error ?? "") ?? ["unclassified", "failed"];
  return err(slackReadFailure(reason, code, args.legacyErrorId, args.retryAfter));
}
