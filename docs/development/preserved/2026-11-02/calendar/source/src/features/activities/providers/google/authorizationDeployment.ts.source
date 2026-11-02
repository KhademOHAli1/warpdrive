import type { Env } from "@/config/env";
import { type CalendarOAuthConfig, readCalendarOAuthConfig } from "./authorizationConfig";

export const CALENDAR_OAUTH_CALLBACK_PATH = "/api/calendar/google/oauth/callback";
export function calendarDeploymentConfig(
  config: Pick<
    Env,
    | "BASE_URL"
    | "GOOGLE_CALENDAR_OAUTH_CLIENT_ID"
    | "GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET"
    | "GOOGLE_CALENDAR_ACCESS"
  >,
): CalendarOAuthConfig | null {
  if (
    config.GOOGLE_CALENDAR_OAUTH_CLIENT_ID === "" ||
    config.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET === ""
  )
    return null;
  const parsed = readCalendarOAuthConfig({
    clientId: config.GOOGLE_CALENDAR_OAUTH_CLIENT_ID,
    clientSecret: config.GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET,
    redirectUri: new URL(CALENDAR_OAUTH_CALLBACK_PATH, config.BASE_URL).href,
    access: config.GOOGLE_CALENDAR_ACCESS,
  });
  return parsed.ok ? parsed.value : null;
}
