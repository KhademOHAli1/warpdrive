import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  calendarOAuthAttempts,
  calendarProviderAccounts,
} from "@/db/schema/calendarProviderAccounts";
import { makeTestDb } from "@/test/db";
import { calendarTestTransport } from "./accountTestHelpers";
import { hashCalendarOAuthToken } from "./authorization";
import {
  BrowserCookieJar,
  blockedBrowserCallback,
  callbackBrowserFlow,
  expectFlowCookie,
  flowCookieName,
  flowStatus,
  startBrowserFlow,
} from "./authorizationBrowserFlows.test-helpers";
import { handleCalendarAuthorizationCallback } from "./authorizationCallbackHttp";
import {
  calendarRouteUser,
  callbackRequest,
  routeBaseUrl,
  routeConfig,
  routeSignal as signal,
} from "./authorizationRoutes.test-helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeEach(async () => {
  ctx = await makeTestDb();
});
afterEach(async () => {
  await ctx.close();
});
const identity = (subject: string) => ({
  subject,
  email: `${subject}@example.invalid`,
  refreshToken: `${subject}-refresh`,
});

it("issues a flow-specific cookie with the fixed attempt deadline and no Max-Age override", async () => {
  const owner = await calendarRouteUser(ctx.db);
  expectFlowCookie(await startBrowserFlow(ctx.db, owner));
});

it("a start response received after its attempt deadline cannot retain a browser binding", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const flow = await startBrowserFlow(ctx.db, owner);
  const jar = new BrowserCookieJar();
  jar.apply(flow.response, Date.parse(flow.expiresAt) + 1_000);
  expect(jar.header(owner.cookie)).toBe(owner.cookie);
});

it("an older callback response arriving after a newer start response cannot erase the newer flow", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const jar = new BrowserCookieJar();
  const older = await startBrowserFlow(ctx.db, owner);
  jar.apply(older.response);
  const pending = await blockedBrowserCallback(ctx.db, owner, jar, older.state, identity("alpha"));
  let newer: Awaited<ReturnType<typeof startBrowserFlow>>;
  try {
    newer = await startBrowserFlow(ctx.db, owner);
    jar.apply(newer.response);
  } finally {
    pending.release.resolve();
    jar.apply(await pending.finishing);
  }
  const current = await callbackBrowserFlow(ctx.db, owner, jar, newer.state, {
    transport: calendarTestTransport(identity("beta")),
  });
  expect(flowStatus(await pending.finishing)).toBe("connected");
  expect(flowStatus(current)).toBe("connected");
  expect(await ctx.db.select().from(calendarProviderAccounts)).toHaveLength(2);
});

it("two first start responses applied in reverse order preserve both different-subject flows", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const older = await startBrowserFlow(ctx.db, owner);
  const newer = await startBrowserFlow(ctx.db, owner);
  const jar = new BrowserCookieJar();
  jar.apply(newer.response);
  jar.apply(older.response);
  const first = await callbackBrowserFlow(ctx.db, owner, jar, newer.state, {
    transport: calendarTestTransport(identity("beta")),
  });
  jar.apply(first);
  const second = await callbackBrowserFlow(ctx.db, owner, jar, older.state, {
    transport: calendarTestTransport(identity("alpha")),
  });
  expect(flowStatus(first)).toBe("connected");
  expect(flowStatus(second)).toBe("connected");
  expect(await ctx.db.select().from(calendarProviderAccounts)).toHaveLength(2);
  expectFlowCookie(older);
  expectFlowCookie(newer);
  expect(older.cookie.value).not.toBe(newer.cookie.value);
});

it("denying A cancels A while preserving B's independent browser binding", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const jar = new BrowserCookieJar();
  const older = await startBrowserFlow(ctx.db, owner);
  jar.apply(older.response);
  const newer = await startBrowserFlow(ctx.db, owner);
  jar.apply(newer.response);
  const denied = await callbackBrowserFlow(ctx.db, owner, jar, older.state, {
    query: { error: "access_denied" },
  });
  jar.apply(denied);
  const finished = await callbackBrowserFlow(ctx.db, owner, jar, newer.state);
  const [attempt] = await ctx.db
    .select()
    .from(calendarOAuthAttempts)
    .where(eq(calendarOAuthAttempts.stateHash, hashCalendarOAuthToken(older.state)));
  expect(flowStatus(denied)).toBe("denied");
  expect(attempt?.cancelledAt).toBeInstanceOf(Date);
  expect(attempt?.codeVerifierEnc).toBeNull();
  expect(flowStatus(finished)).toBe("connected");
});

it("a malformed callback clears no browser cookies and cannot disrupt a valid pending flow", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const jar = new BrowserCookieJar();
  const flow = await startBrowserFlow(ctx.db, owner);
  jar.apply(flow.response);
  const malformed = await callbackBrowserFlow(ctx.db, owner, jar, "invalid-state");
  jar.apply(malformed);
  const finished = await callbackBrowserFlow(ctx.db, owner, jar, flow.state);
  expect(flowStatus(malformed)).toBe("error");
  expect(malformed.headers.getSetCookie()).toHaveLength(0);
  expect(flowStatus(finished)).toBe("connected");
});

it("B's cookie cannot satisfy A, even when B's nonce is copied under A's expected cookie name", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const older = await startBrowserFlow(ctx.db, owner);
  const newer = await startBrowserFlow(ctx.db, owner);
  const transport = calendarTestTransport();
  for (const browserCookie of [
    `${newer.cookie.name}=${newer.cookie.value}`,
    `${flowCookieName(older.state)}=${newer.cookie.value}`,
  ]) {
    const response = await handleCalendarAuthorizationCallback(
      ctx.db,
      callbackRequest(older.state, `${owner.cookie}; ${browserCookie}`),
      signal(),
      { config: routeConfig, baseUrl: routeBaseUrl, transport },
    );
    expect(flowStatus(response)).toBe("error");
  }
  expect(transport).not.toHaveBeenCalled();
  const [attempt] = await ctx.db
    .select()
    .from(calendarOAuthAttempts)
    .where(eq(calendarOAuthAttempts.stateHash, hashCalendarOAuthToken(older.state)));
  expect(attempt?.consumedAt).toBeNull();
  expect(await ctx.db.select().from(calendarProviderAccounts)).toHaveLength(0);
});

it("independent cookies retain the generation fence when newer same-subject consent finishes first", async () => {
  const owner = await calendarRouteUser(ctx.db);
  const jar = new BrowserCookieJar();
  const older = await startBrowserFlow(ctx.db, owner);
  jar.apply(older.response);
  const pending = await blockedBrowserCallback(ctx.db, owner, jar, older.state, identity("same"));
  let current: Response;
  try {
    const newer = await startBrowserFlow(ctx.db, owner);
    jar.apply(newer.response);
    current = await callbackBrowserFlow(ctx.db, owner, jar, newer.state, {
      transport: calendarTestTransport({ ...identity("same"), email: "newer@example.invalid" }),
    });
    jar.apply(current);
  } finally {
    pending.release.resolve();
    jar.apply(await pending.finishing);
  }
  expect(flowStatus(current)).toBe("connected");
  expect(flowStatus(await pending.finishing)).toBe("error");
  const rows = await ctx.db.select().from(calendarProviderAccounts);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.emailAddress).toBe("newer@example.invalid");
});
