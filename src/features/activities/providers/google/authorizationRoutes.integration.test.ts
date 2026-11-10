import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { authUsers, sessions, users } from "@/db/schema";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import { logoutCurrentRequest } from "@/features/auth/better/logoutCurrentRequest";
import { makeTestDb } from "@/test/db";
import { calendarTestTransport, connectTestCalendar } from "./accountTestHelpers";
import { handleCalendarAuthorizationCallback } from "./authorizationCallbackHttp";
import {
  calendarRouteUser,
  callbackRequest,
  routeBaseUrl,
  routeConfig,
  routeSignal as signal,
  startRequest,
  startRoute,
} from "./authorizationRoutes.test-helpers";
import { handleCalendarAuthorizationStart } from "./authorizationStartHttp";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});
const options = () => ({ config: routeConfig, baseUrl: routeBaseUrl });

it("starts only with a live session and CSRF, issuing a callback-scoped HttpOnly browser cookie", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const start = await startRoute(ctx.db, owner);
  const cookies = start.response.headers.getSetCookie().join(";");
  expect(cookies).toContain("HttpOnly");
  expect(cookies).toContain("SameSite=lax");
  expect(cookies).toContain("Secure");
  expect(cookies).toContain("Path=/api/calendar/google/oauth/callback");
  expect(cookies).toContain(`Expires=${new Date(start.expiresAt).toUTCString()}`);
  expect(cookies).not.toContain("Max-Age=");
  expect(start.response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.stringify(await start.response.clone().json())).not.toContain("browserNonce");
  expect(JSON.stringify(await start.response.clone().json())).not.toContain(
    "private-calendar-secret",
  );
  expect(await ctx.db.select().from(calendarOAuthAttempts)).toHaveLength(1);
});
it("rejects prefetch GET, cross-site/missing CSRF, anonymous requests and client-supplied owner IDs", async () => {
  const owner = await calendarRouteUser(ctx.db);
  for (const [request, status] of [
    [new Request(new URL("/api/calendar/google/oauth/start", routeBaseUrl)), 405],
    [startRequest(owner, {}, { origin: "https://attacker.invalid" }), 403],
    [startRequest(owner, {}, { "x-csrf-token": "" }), 403],
    [startRequest(owner, {}, { cookie: `wd_csrf=${owner.csrf}` }), 401],
    [startRequest(owner, { userId: owner.user.id }), 400],
  ] as const) {
    const response = await handleCalendarAuthorizationStart(ctx.db, request, signal(), options());
    expect(response.status).toBe(status);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  }
  expect(await ctx.db.select().from(calendarOAuthAttempts)).toHaveLength(0);
});
it("returns an unconfigured state without reading Gmail app credentials or writing an attempt", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const response = await handleCalendarAuthorizationStart(ctx.db, startRequest(owner), signal(), {
    ...options(),
    config: null,
  });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
  expect(await ctx.db.select().from(calendarOAuthAttempts)).toHaveLength(0);
});
it("binds the callback to its signed-in owner and browser, clears the cookie and redirects only to fixed connection settings", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const start = await startRoute(ctx.db, owner);
  const transport = calendarTestTransport();
  const response = await handleCalendarAuthorizationCallback(
    ctx.db,
    callbackRequest(start.state, start.cookie, {
      code: "code",
      returnTo: "https://attacker.invalid",
    }),
    signal(),
    { ...options(), transport },
  );
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    new URL("/settings/connections?googleConnect=connected", routeBaseUrl).href,
  );
  expect(response.headers.getSetCookie().join(";")).toContain("Max-Age=0");
  expect((await ctx.db.select().from(calendarProviderAccounts))[0]?.userId).toBe(owner.user.id);
  expect(transport).toHaveBeenCalledTimes(2);
  const replay = await handleCalendarAuthorizationCallback(
    ctx.db,
    callbackRequest(start.state, start.cookie),
    signal(),
    { ...options(), transport },
  );
  expect(replay.headers.get("location")).toBe(
    new URL("/settings/connections?googleConnect=error", routeBaseUrl).href,
  );
  expect(transport).toHaveBeenCalledTimes(2);
});
it("rejects a different session owner or absent browser binding before any provider transport", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const stranger = await calendarRouteUser(ctx.db);
  const start = await startRoute(ctx.db, owner);
  const transport = calendarTestTransport();
  for (const [cookie, status] of [
    [`${stranger.cookie}; ${start.browserCookie}`, "error"],
    [owner.cookie, "error"],
    ["", "signed_out"],
  ] as const) {
    const response = await handleCalendarAuthorizationCallback(
      ctx.db,
      callbackRequest(start.state, cookie),
      signal(),
      { ...options(), transport },
    );
    expect(response.headers.get("location")).toBe(
      new URL(`/settings/connections?googleConnect=${status}`, routeBaseUrl).href,
    );
  }
  expect(transport).not.toHaveBeenCalled();
  expect((await ctx.db.select().from(calendarOAuthAttempts))[0]?.consumedAt).toBeNull();
});
it("consumes a valid provider denial while a wrong-owner denial cannot cancel another attempt", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const stranger = await calendarRouteUser(ctx.db);
  const start = await startRoute(ctx.db, owner);
  const transport = calendarTestTransport();
  await handleCalendarAuthorizationCallback(
    ctx.db,
    callbackRequest(start.state, `${stranger.cookie}; ${start.browserCookie}`, {
      error: "access_denied",
    }),
    signal(),
    { ...options(), transport },
  );
  expect((await ctx.db.select().from(calendarOAuthAttempts))[0]?.cancelledAt).toBeNull();
  const denied = await handleCalendarAuthorizationCallback(
    ctx.db,
    callbackRequest(start.state, start.cookie, {
      error: "access_denied",
      error_description: "private details",
    }),
    signal(),
    { ...options(), transport },
  );
  expect(denied.headers.get("location")).toBe(
    new URL("/settings/connections?googleConnect=denied", routeBaseUrl).href,
  );
  expect((await ctx.db.select().from(calendarOAuthAttempts))[0]).toMatchObject({
    cancelledAt: expect.any(Date),
    codeVerifierEnc: null,
  });
  await handleCalendarAuthorizationCallback(
    ctx.db,
    callbackRequest(start.state, start.cookie),
    signal(),
    { ...options(), transport },
  );
  expect(transport).not.toHaveBeenCalled();
});
it("respects revoked/inactive sessions and native pending MFA instead of trusting the session cookie alone", async () => {
  const owner = await calendarRouteUser(ctx.db);
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.id, owner.session.sessionId));
  expect(
    (await handleCalendarAuthorizationStart(ctx.db, startRequest(owner), signal(), options()))
      .status,
  ).toBe(401);
  await ctx.db
    .update(sessions)
    .set({ revokedAt: null })
    .where(eq(sessions.id, owner.session.sessionId));
  await ctx.db.update(users).set({ isActive: false }).where(eq(users.id, owner.user.id));
  expect(
    (await handleCalendarAuthorizationStart(ctx.db, startRequest(owner), signal(), options()))
      .status,
  ).toBe(401);
  await ctx.db.update(users).set({ isActive: true }).where(eq(users.id, owner.user.id));
  await ctx.db
    .insert(authUsers)
    .values({ id: owner.user.id, email: owner.user.email, name: "Native", emailVerified: true });
  await ctx.db
    .update(sessions)
    .set({ authMethod: "password", assurance: "pending" })
    .where(eq(sessions.id, owner.session.sessionId));
  expect(
    (await handleCalendarAuthorizationStart(ctx.db, startRequest(owner), signal(), options()))
      .status,
  ).toBe(401);
});

it("a HEAD callback is inert and cannot consume or exchange an authorization code", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const start = await startRoute(ctx.db, owner);
  const transport = calendarTestTransport();
  const request = callbackRequest(start.state, start.cookie);
  const response = await handleCalendarAuthorizationCallback(
    ctx.db,
    new Request(request.url, { method: "HEAD", headers: request.headers }),
    signal(),
    { ...options(), transport },
  );
  expect(response.status).toBe(405);
  expect(transport).not.toHaveBeenCalled();
  expect((await ctx.db.select().from(calendarOAuthAttempts))[0]?.consumedAt).toBeNull();
});

it("ordinary logout retains the Calendar grant while its revoked session cannot finish a pending callback", async () => {
  const owner = await calendarRouteUser(ctx.db);
  await connectTestCalendar(ctx.db, owner.user.id);
  const start = await startRoute(ctx.db, owner);
  const transport = calendarTestTransport();
  const logout = await logoutCurrentRequest(
    ctx.db,
    new Request(new URL("/auth/logout", routeBaseUrl), {
      method: "POST",
      headers: {
        origin: new URL(routeBaseUrl).origin,
        cookie: owner.cookie,
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({ csrfToken: owner.csrf }),
    }),
    signal(),
  );
  expect(logout.status).toBe(303);
  expect((await ctx.db.select().from(calendarProviderAccounts))[0]?.status).toBe("connected");
  const callback = await handleCalendarAuthorizationCallback(
    ctx.db,
    callbackRequest(start.state, start.cookie),
    signal(),
    { ...options(), transport },
  );
  expect(callback.headers.get("location")).toBe(
    new URL("/settings/connections?googleConnect=signed_out", routeBaseUrl).href,
  );
  expect(transport).not.toHaveBeenCalled();
});

it("an unconfigured callback returns only to connection settings and clears the browser cookie", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const start = await startRoute(ctx.db, owner);
  const transport = calendarTestTransport();
  const response = await handleCalendarAuthorizationCallback(
    ctx.db,
    callbackRequest(start.state, start.cookie),
    signal(),
    { ...options(), config: null, transport },
  );
  expect(response.headers.get("location")).toBe(
    new URL("/settings/connections?googleConnect=unavailable", routeBaseUrl).href,
  );
  expect(response.headers.getSetCookie().join(";")).toContain("Max-Age=0");
  expect(transport).not.toHaveBeenCalled();
});
