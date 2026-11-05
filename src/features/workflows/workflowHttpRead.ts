import { ok } from "@/types/result";
import {
  httpReadFailure,
  projectWorkflowHttpRelease,
  reviewedHttpReadProfile,
  type WorkflowHttpReadProfile,
} from "./workflowHttpReadContract";
import {
  exchangeWorkflowHttps,
  type HttpsFailureReason,
  type WorkflowHttpsDependencies,
  type WorkflowHttpsTransport,
} from "./workflowHttpRequestTransport";

export type WorkflowHttpReadTransport = WorkflowHttpsTransport;

const jsonContentType =
  /^application\/(?:json|vnd\.github\+json)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?$/i;

function decode(payload: Buffer) {
  try {
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    return projectWorkflowHttpRelease(raw);
  } catch {
    return httpReadFailure("invalid_response");
  }
}

function transportFailure(reason: HttpsFailureReason) {
  return httpReadFailure(reason).error;
}

export async function readWorkflowHttp(
  profileId: WorkflowHttpReadProfile,
  signal: AbortSignal,
  dependencies: WorkflowHttpsDependencies = {},
) {
  if (signal.aborted) return httpReadFailure("cancelled");
  const profile = reviewedHttpReadProfile(profileId);
  if (profile === undefined) return httpReadFailure("invalid_profile");
  const exchange = await exchangeWorkflowHttps(
    {
      hostname: profile.hostname,
      port: profile.port,
      path: profile.path,
      method: "GET",
      headers: {
        Host: profile.hostname,
        Accept: profile.accept,
        "Accept-Encoding": "identity",
        "User-Agent": profile.userAgent,
      },
    },
    signal,
    {
      failure: transportFailure,
      validate(response) {
        if (response.statusCode !== 200) return httpReadFailure("unexpected_status");
        const media = response.headers["content-type"];
        return typeof media === "string" && jsonContentType.test(media.trim())
          ? ok(undefined)
          : httpReadFailure("invalid_response");
      },
      decode: (_response, payload) => decode(payload),
    },
    dependencies,
  );
  return exchange.result;
}
