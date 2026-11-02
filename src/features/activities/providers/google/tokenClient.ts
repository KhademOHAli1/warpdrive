import { err, ok, type Result } from "@/types/result";
import {
  type CalendarAuthorizationError,
  type CalendarOAuthConfig,
  readCalendarOAuthConfig,
} from "./authorizationConfig";
import { type GoogleTransport, hasCalendarScope } from "./contracts";
import { calendarOAuthRequest } from "./tokenHttp";
import {
  type CalendarGoogleIdentity,
  type CalendarTokenResponse,
  codeExchangeSchema,
  googleIdentitySchema,
  refreshInputSchema,
  tokenResponseSchema,
} from "./tokenSchemas";
import { googleFetch } from "./transport";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
export function hasRequiredCalendarConsent(
  scopes: readonly string[],
  access: CalendarOAuthConfig["access"],
): boolean {
  const grant = { accessToken: "", grantedScopes: scopes };
  return (
    scopes.includes("openid") &&
    (scopes.includes("email") ||
      scopes.includes("https://www.googleapis.com/auth/userinfo.email")) &&
    hasCalendarScope(grant, "calendar_list") &&
    hasCalendarScope(grant, access === "readWrite" ? "events_write" : "events_read")
  );
}
async function tokenRequest(
  config: CalendarOAuthConfig,
  params: Record<string, string>,
  signal: AbortSignal,
  transport: GoogleTransport,
) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...params,
  });
  return calendarOAuthRequest(
    transport,
    TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
    tokenResponseSchema,
    signal,
  );
}
export async function exchangeCalendarCode(
  config: CalendarOAuthConfig,
  input: { code: string; codeVerifier: string; signal: AbortSignal },
  transport: GoogleTransport = googleFetch,
): Promise<
  Result<CalendarTokenResponse & { grantedScopes: string[] }, CalendarAuthorizationError>
> {
  input.signal.throwIfAborted();
  const validated = readCalendarOAuthConfig(config);
  if (!validated.ok) return validated;
  const parsed = codeExchangeSchema.safeParse(input);
  if (!parsed.success) return err({ kind: "invalid_input" });
  const result = await tokenRequest(
    validated.value,
    {
      grant_type: "authorization_code",
      code: parsed.data.code,
      code_verifier: parsed.data.codeVerifier,
      redirect_uri: validated.value.redirectUri,
    },
    input.signal,
    transport,
  );
  if (!result.ok) return result;
  if (
    result.value.grantedScopes === undefined ||
    !hasRequiredCalendarConsent(result.value.grantedScopes, config.access)
  )
    return err({ kind: "missing_scope" });
  return ok({ ...result.value, grantedScopes: result.value.grantedScopes });
}
export async function refreshCalendarToken(
  config: CalendarOAuthConfig,
  input: { refreshToken: string; signal: AbortSignal },
  transport: GoogleTransport = googleFetch,
): Promise<Result<CalendarTokenResponse, CalendarAuthorizationError>> {
  input.signal.throwIfAborted();
  const validated = readCalendarOAuthConfig(config);
  if (!validated.ok) return validated;
  const parsed = refreshInputSchema.safeParse(input);
  if (!parsed.success) return err({ kind: "invalid_input" });
  const result = await tokenRequest(
    validated.value,
    { grant_type: "refresh_token", refresh_token: parsed.data.refreshToken },
    input.signal,
    transport,
  );
  if (
    result.ok &&
    result.value.grantedScopes !== undefined &&
    !hasRequiredCalendarConsent(result.value.grantedScopes, config.access)
  )
    return err({ kind: "missing_scope" });
  return result;
}
export async function fetchCalendarIdentity(
  accessToken: string,
  signal: AbortSignal,
  transport: GoogleTransport = googleFetch,
): Promise<Result<CalendarGoogleIdentity, CalendarAuthorizationError>> {
  signal.throwIfAborted();
  if (accessToken.length === 0 || accessToken.length > 16_384)
    return err({ kind: "invalid_input" });
  const result = await calendarOAuthRequest(
    transport,
    USERINFO_ENDPOINT,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    googleIdentitySchema,
    signal,
  );
  return !result.ok && result.error.kind === "invalid_response"
    ? err({ kind: "identity_unverified" })
    : result;
}
