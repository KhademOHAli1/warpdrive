import { expect, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { beginCalendarAuthorization, finishCalendarAuthorization } from "./accountAuthorization";
import type { CalendarOAuthConfig } from "./authorizationConfig";

export const calendarTestConfig: CalendarOAuthConfig = {
  clientId: "calendar-client",
  clientSecret: "private-client-secret",
  redirectUri: "https://crm.example.invalid/api/calendar/google/callback",
  access: "readWrite",
};
export const calendarTestScope =
  "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events";
export const calendarTestSignal = () => AbortSignal.timeout(10_000);
export function calendarTestTransport(
  options: {
    subject?: string;
    email?: string;
    verified?: boolean;
    refreshToken?: string | null;
    scope?: string;
  } = {},
) {
  return vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      url.endsWith("/token")
        ? new Response(
            JSON.stringify({
              access_token: "access-token",
              expires_in: 3600,
              token_type: "Bearer",
              scope: options.scope ?? calendarTestScope,
              ...(options.refreshToken === null
                ? {}
                : { refresh_token: options.refreshToken ?? "refresh-secret" }),
            }),
          )
        : new Response(
            JSON.stringify({
              sub: options.subject ?? "external-sub",
              email: options.email ?? "external@example.invalid",
              email_verified: options.verified ?? true,
            }),
          ),
    ),
  );
}
export async function beginTestCalendar(db: Db, userId: string, accountId?: string) {
  const result = await beginCalendarAuthorization(
    db,
    userId,
    calendarTestConfig,
    calendarTestSignal(),
    { accountId },
  );
  expect(result.ok).toBe(true);
  if (!result.ok)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "calendar authorization fixture failed");
  return result.value;
}
export async function connectTestCalendar(
  db: Db,
  userId: string,
  options: Parameters<typeof calendarTestTransport>[0] = {},
) {
  const start = await beginTestCalendar(db, userId);
  const result = await finishCalendarAuthorization(
    db,
    userId,
    calendarTestConfig,
    { state: start.state, browserNonce: start.browserNonce, code: "one-use-code" },
    calendarTestSignal(),
    { transport: calendarTestTransport(options) },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "calendar connection fixture failed");
  return result.value;
}
export function deferredValue<T>() {
  let resolve: (value: T) => void = () => {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "deferred not initialized");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
