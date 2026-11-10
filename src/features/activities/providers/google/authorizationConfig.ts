import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

export interface CalendarOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  access: "readOnly" | "readWrite";
}
export interface CalendarAuthorizationError {
  kind:
    | "configuration"
    | "invalid_input"
    | "invalid_state"
    | "missing_scope"
    | "identity_unverified"
    | "identity_mismatch"
    | "refresh_missing"
    | "network"
    | "unauthorized"
    | "forbidden"
    | "rate_limited"
    | "provider_unavailable"
    | "provider_rejected"
    | "invalid_response"
    | "credential_corrupt"
    | "not_found"
    | "disconnected"
    | "conflict";
  status?: number;
}

const redirectSchema = z.url().refine((value) => {
  const url = new URL(value);
  const loopback =
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.hostname.endsWith(".localhost");
  return (
    (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
    url.username === "" &&
    url.password === "" &&
    url.hash === "" &&
    url.search === ""
  );
});
const configSchema = z.object({
  clientId: z.string().min(1).max(1024),
  clientSecret: z.string().min(1).max(4096),
  redirectUri: redirectSchema,
  access: z.enum(["readOnly", "readWrite"]),
});
export function readCalendarOAuthConfig(
  input: CalendarOAuthConfig,
): Result<CalendarOAuthConfig, CalendarAuthorizationError> {
  const parsed = configSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err({ kind: "configuration" });
}
export function calendarAuthorizationScopes(access: CalendarOAuthConfig["access"]): string[] {
  return [
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    `https://www.googleapis.com/auth/calendar.events${access === "readOnly" ? ".readonly" : ""}`,
  ];
}
export const CALENDAR_OAUTH_BROWSER_COOKIE = "calendar_google_oauth_browser";
export const CALENDAR_OAUTH_TTL_MS = 10 * 60_000;
