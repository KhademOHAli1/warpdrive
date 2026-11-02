import { err, ok } from "@/types/result";
import { AUTH_STAGING_LOCALES, authStagingSchema } from "./authStagingSchemas";
import {
  type AuthStagingHttpsCheck,
  type AuthStagingTrust,
  observeAuthStagingLogin,
} from "./authStagingTransport";

export async function probeAuthStagingHttps(
  input: unknown,
  signal: AbortSignal,
  trust: AuthStagingTrust = {},
  clock: () => Date = () => new Date(),
) {
  signal.throwIfAborted();
  const parsed = authStagingSchema.safeParse(input);
  const checks: AuthStagingHttpsCheck[] = [];
  if (!parsed.success)
    return err({ code: "staging_input_invalid" as const, completedChecks: checks });
  const config = parsed.data;
  if (config.origin === null || config.revision === null)
    return err({ code: "probe_inputs_missing" as const, completedChecks: checks });
  const authorization = config.probeAuthorization;
  if (
    authorization === null ||
    authorization.origin !== config.origin ||
    authorization.revision !== config.revision
  )
    return err({ code: "probe_not_authorized" as const, completedChecks: checks });
  for (const locale of AUTH_STAGING_LOCALES) {
    if (new Date(authorization.expiresAt) <= clock())
      return err({ code: "probe_not_authorized" as const, locale, completedChecks: checks });
    const result = await observeAuthStagingLogin(config.origin, locale, signal, trust);
    if (!result.ok) return err({ code: result.error, locale, completedChecks: checks });
    checks.push(result.value);
  }
  return ok({
    version: 1 as const,
    command: "privacy-staging-auth:anonymous_https_login" as const,
    observedAt: clock().toISOString(),
    evidenceLevel:
      config.environment === "synthetic"
        ? ("synthetic" as const)
        : ("installed_transport_observation" as const),
    accepted: false as const,
    revisionVerified: false as const,
    expectedRevision: config.revision,
    origin: config.origin,
    checks,
    remainingGates: [
      "deployment_revision",
      "session_cookies",
      "smtp_tls",
      "external_reset_delivery",
      "external_notice_delivery",
      "physical_passkey",
      "fallback_recovery",
      "localized_recovery",
      "origin_csrf",
      "expiry_replay",
      "provider_boundary",
    ],
  });
}
