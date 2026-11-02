import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { seedUser } from "@/db/testing/factories";
import { mintCsrfToken } from "@/features/auth/csrf";
import { createSession } from "@/features/auth/session";
import { hashCalendarOAuthToken } from "./authorization";
import { CALENDAR_OAUTH_BROWSER_COOKIE } from "./authorizationConfig";
import { handleCalendarAuthorizationStart } from "./authorizationStartHttp";

export const routeSignal = () => AbortSignal.timeout(10_000);
export const routeBaseUrl = env.BASE_URL;
export const routeConfig = {
  clientId: "dedicated-calendar",
  clientSecret: "private-calendar-secret",
  redirectUri: new URL("/api/calendar/google/oauth/callback", routeBaseUrl).href,
  access: "readWrite" as const,
};
export async function calendarRouteUser(db: Db) {
  const user = await seedUser(db);
  const session = await createSession(db, user.id, routeSignal());
  if (!session.ok) throw new AppError(ERROR_IDS.DB_INVARIANT, "route fixture session failed");
  const csrf = mintCsrfToken();
  return {
    user,
    session: session.value,
    csrf,
    cookie: `wd_sid=${session.value.sid}; wd_csrf=${csrf}`,
  };
}
export function startRequest(
  owner: Awaited<ReturnType<typeof calendarRouteUser>>,
  body: unknown = {},
  override: Record<string, string> = {},
) {
  return new Request(new URL("/api/calendar/google/oauth/start", routeBaseUrl), {
    method: "POST",
    headers: {
      origin: new URL(routeBaseUrl).origin,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "x-csrf-token": owner.csrf,
      cookie: owner.cookie,
      ...override,
    },
    body: JSON.stringify(body),
  });
}
export async function startRoute(db: Db, owner: Awaited<ReturnType<typeof calendarRouteUser>>) {
  const response = await handleCalendarAuthorizationStart(db, startRequest(owner), routeSignal(), {
    config: routeConfig,
    baseUrl: routeBaseUrl,
  });
  if (response.status !== 200) throw new AppError(ERROR_IDS.DB_INVARIANT, "route start failed");
  const data = (await response.clone().json()) as {
    ok: boolean;
    data: { authorizationUrl: string; expiresAt: string };
  };
  const state = new URL(data.data.authorizationUrl).searchParams.get("state");
  if (state === null) throw new AppError(ERROR_IDS.DB_INVARIANT, "route state fixture absent");
  const cookie = response.headers
    .getSetCookie()
    .find((value) =>
      value.startsWith(`${CALENDAR_OAUTH_BROWSER_COOKIE}_${hashCalendarOAuthToken(state)}=`),
    )
    ?.split(";")[0];
  if (cookie === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "route browser cookie fixture absent");
  return {
    response,
    state,
    expiresAt: data.data.expiresAt,
    browserCookie: cookie,
    cookie: `${owner.cookie}; ${cookie}`,
  };
}
export function callbackRequest(
  state: string,
  cookie: string,
  query: Record<string, string> = { code: "one-use-code" },
) {
  const url = new URL("/api/calendar/google/oauth/callback", routeBaseUrl);
  url.search = new URLSearchParams({ state, ...query }).toString();
  return new Request(url, { headers: { cookie } });
}
