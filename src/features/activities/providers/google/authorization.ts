import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import {
  type CalendarAuthorizationError,
  type CalendarOAuthConfig,
  calendarAuthorizationScopes,
  readCalendarOAuthConfig,
} from "./authorizationConfig";
import type { CalendarGoogleIdentity } from "./tokenSchemas";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const calendarOpaqueTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export function hashCalendarOAuthToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function createCalendarAuthorizationMaterial() {
  const state = randomBytes(32).toString("base64url");
  const browserNonce = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(32).toString("base64url");
  return {
    state,
    browserNonce,
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
    stateHash: hashCalendarOAuthToken(state),
    browserBindingHash: hashCalendarOAuthToken(browserNonce),
  };
}
export function buildCalendarAuthorizationUrl(
  config: CalendarOAuthConfig,
  material: { state: string; codeChallenge: string },
): Result<string, CalendarAuthorizationError> {
  const validated = readCalendarOAuthConfig(config);
  if (!validated.ok) return validated;
  if (
    !calendarOpaqueTokenSchema.safeParse(material.state).success ||
    !calendarOpaqueTokenSchema.safeParse(material.codeChallenge).success
  )
    return err({ kind: "invalid_input" });
  const query = new URLSearchParams({
    client_id: validated.value.clientId,
    redirect_uri: validated.value.redirectUri,
    response_type: "code",
    scope: calendarAuthorizationScopes(validated.value.access).join(" "),
    access_type: "offline",
    include_granted_scopes: "false",
    prompt: "consent select_account",
    state: material.state,
    code_challenge: material.codeChallenge,
    code_challenge_method: "S256",
  });
  return ok(`${AUTHORIZATION_ENDPOINT}?${query.toString()}`);
}
export interface CalendarIdentityPolicy {
  workspaceEmail: string;
  expectedSubject?: string;
  requireSameEmail?: boolean;
  allowedDomain?: string;
}
export function validateCalendarIdentity(
  identity: CalendarGoogleIdentity,
  policy: CalendarIdentityPolicy,
): Result<undefined, CalendarAuthorizationError> {
  if (
    (policy.expectedSubject !== undefined && identity.subject !== policy.expectedSubject) ||
    (policy.requireSameEmail === true &&
      identity.emailAddress.toLowerCase() !== policy.workspaceEmail.trim().toLowerCase()) ||
    (policy.allowedDomain !== undefined &&
      identity.hostedDomain?.toLowerCase() !== policy.allowedDomain.toLowerCase())
  )
    return err({ kind: "identity_mismatch" });
  return ok(undefined);
}
