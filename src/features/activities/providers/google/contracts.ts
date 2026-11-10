import type { Result } from "@/types/result";

export type GoogleCalendarErrorKind =
  | "missing_scope"
  | "invalid_input"
  | "invalid_response"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "sync_expired"
  | "rate_limited"
  | "provider_unavailable"
  | "provider_rejected"
  | "calendar_read_only"
  | "conference_not_supported"
  | "conference_sync_required";
export interface GoogleCalendarError {
  kind: GoogleCalendarErrorKind;
  status?: number;
  retryAfterSeconds?: number;
}
export type GoogleResult<T> = Result<T, GoogleCalendarError>;
export type GoogleTransport = (
  url: string,
  init: RequestInit & { signal: AbortSignal },
) => Promise<Response>;
export interface GoogleCalendarGrant {
  accessToken: string;
  grantedScopes: readonly string[];
}
export interface SignalInput {
  signal: AbortSignal;
}
export interface EventIdentity extends SignalInput {
  calendarId: string;
  eventId: string;
}
export interface EventPageInput extends SignalInput {
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
}

// These capabilities describe the granted Calendar token, never an OIDC or Gmail grant.
const SCOPE_ROOT = "https://www.googleapis.com/auth/";
const CALENDAR_LIST_SCOPES = [
  "calendar",
  "calendar.readonly",
  "calendar.calendarlist",
  "calendar.calendarlist.readonly",
];
const EVENT_READ_SCOPES = [
  "calendar",
  "calendar.readonly",
  "calendar.events",
  "calendar.events.readonly",
];
const EVENT_WRITE_SCOPES = ["calendar", "calendar.events"];
export type CalendarCapability = "calendar_list" | "events_read" | "events_write";
export function hasCalendarScope(
  grant: GoogleCalendarGrant,
  capability: CalendarCapability,
): boolean {
  const allowed =
    capability === "calendar_list"
      ? CALENDAR_LIST_SCOPES
      : capability === "events_read"
        ? EVENT_READ_SCOPES
        : EVENT_WRITE_SCOPES;
  return allowed.some((scope) => grant.grantedScopes.includes(`${SCOPE_ROOT}${scope}`));
}
