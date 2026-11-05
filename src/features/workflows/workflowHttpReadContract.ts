import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { GITHUB_RELEASES_URL, RELEASE_FETCH_USER_AGENT } from "@/features/release/constants";
import { isDistributionReleaseUrl } from "@/features/release/releaseProvenance";
import { err, ok } from "@/types/result";

export const WORKFLOW_HTTP_READ_TIMEOUT_MS = 5_000;
export const WORKFLOW_HTTP_READ_MAX_BYTES = 256 * 1024;
export const WORKFLOW_HTTP_READ_MAX_HEADER_BYTES = 8 * 1024;

export const workflowHttpReadProfileId = "warpdrive.latestRelease";
export type WorkflowHttpReadProfile = typeof workflowHttpReadProfileId;

const releaseEndpoint = new URL(GITHUB_RELEASES_URL);
const releaseProfile = Object.freeze({
  hostname: "api.github.com",
  port: 443,
  path: releaseEndpoint.pathname,
  accept: "application/vnd.github+json",
  userAgent: RELEASE_FETCH_USER_AGENT,
});

// Only the source-reviewed public distribution release operation is admitted.
// An ID never grants the caller control of the URL, method, headers or payload.
export function reviewedHttpReadProfile(profile: unknown) {
  if (
    profile !== workflowHttpReadProfileId ||
    releaseEndpoint.origin !== `https://${releaseProfile.hostname}` ||
    releaseEndpoint.username !== "" ||
    releaseEndpoint.password !== "" ||
    releaseEndpoint.search !== "" ||
    releaseEndpoint.hash !== "" ||
    !/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/latest$/.test(releaseProfile.path)
  )
    return undefined;
  return releaseProfile;
}

export type WorkflowHttpReadFailureReason =
  | "invalid_profile"
  | "invalid_budget"
  | "destination_denied"
  | "unavailable"
  | "timed_out"
  | "cancelled"
  | "unexpected_status"
  | "invalid_response"
  | "response_limit";

export interface WorkflowHttpReadFailure {
  id:
    | typeof ERROR_IDS.WORKFLOW_DENIED
    | typeof ERROR_IDS.WORKFLOW_INVALID
    | typeof ERROR_IDS.WORKFLOW_NOT_READY;
  reason: WorkflowHttpReadFailureReason;
}

export function httpReadFailure(reason: WorkflowHttpReadFailureReason) {
  let id: WorkflowHttpReadFailure["id"] = ERROR_IDS.WORKFLOW_NOT_READY;
  if (reason === "destination_denied") id = ERROR_IDS.WORKFLOW_DENIED;
  else if (
    reason === "invalid_profile" ||
    reason === "invalid_budget" ||
    reason === "invalid_response" ||
    reason === "response_limit"
  )
    id = ERROR_IDS.WORKFLOW_INVALID;
  return err<WorkflowHttpReadFailure>({ id, reason });
}

const releaseResponse = z.object({
  tag_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
  html_url: z.string().max(1024).refine(isDistributionReleaseUrl),
});

export interface WorkflowHttpReadOutput {
  latestTag: string;
  releaseUrl: string;
}

export function projectWorkflowHttpRelease(raw: unknown) {
  const parsed = releaseResponse.safeParse(raw);
  if (!parsed.success) return httpReadFailure("invalid_response");
  const { tag_name: latestTag, html_url: releaseUrl } = parsed.data;
  if (!new URL(releaseUrl).pathname.endsWith(`/releases/tag/${latestTag}`))
    return httpReadFailure("invalid_response");
  return ok<WorkflowHttpReadOutput>({ latestTag, releaseUrl });
}
