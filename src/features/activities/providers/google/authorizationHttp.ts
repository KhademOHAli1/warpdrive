import { NextResponse } from "next/server";
import type { Db } from "@/db/client";
import { readCookie } from "@/features/auth/better/sessionToken";
import { loadLiveSessionByToken, SESSION_COOKIE } from "@/features/auth/session";
import { hashCalendarOAuthToken } from "./authorization";
import { CALENDAR_OAUTH_BROWSER_COOKIE, type CalendarOAuthConfig } from "./authorizationConfig";
import { CALENDAR_OAUTH_CALLBACK_PATH } from "./authorizationDeployment";

export interface CalendarOAuthHttpOptions {
  config: CalendarOAuthConfig | null;
  baseUrl: string;
}
export function calendarHttpJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
export async function calendarHttpOwner(
  db: Db,
  request: Request,
  signal: AbortSignal,
): Promise<string | null> {
  const cookie = readCookie(request.headers, SESSION_COOKIE);
  if (cookie === null) return null;
  const session = await loadLiveSessionByToken(db, cookie, signal);
  return session.ok ? session.value.userId : null;
}
export function calendarBrowserCookieName(state: string): string {
  return `${CALENDAR_OAUTH_BROWSER_COOKIE}_${hashCalendarOAuthToken(state)}`;
}
export function setCalendarBrowserCookie(
  response: NextResponse,
  state: string,
  nonce: string,
  baseUrl: string,
  expiresAt: Date,
  clear = false,
): void {
  response.cookies.set(calendarBrowserCookieName(state), nonce, {
    httpOnly: true,
    secure: new URL(baseUrl).protocol === "https:",
    sameSite: "lax",
    path: CALENDAR_OAUTH_CALLBACK_PATH,
    expires: expiresAt,
    ...(clear ? { maxAge: 0 } : {}),
  });
}
export function calendarCallbackRedirect(
  baseUrl: string,
  status: "connected" | "denied" | "error" | "unavailable" | "signed_out",
  state?: string,
): NextResponse {
  const target = new URL("/settings/connections", baseUrl);
  target.searchParams.set("googleConnect", status);
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (state !== undefined)
    setCalendarBrowserCookie(response, state, "", baseUrl, new Date(0), true);
  return response;
}
