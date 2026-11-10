import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import { calendarTestTransport, deferredValue } from "./accountTestHelpers";
import { hashCalendarOAuthToken } from "./authorization";
import { handleCalendarAuthorizationCallback } from "./authorizationCallbackHttp";
import { CALENDAR_OAUTH_BROWSER_COOKIE } from "./authorizationConfig";
import { CALENDAR_OAUTH_CALLBACK_PATH } from "./authorizationDeployment";
import {
  type calendarRouteUser,
  callbackRequest,
  routeBaseUrl,
  routeConfig,
  routeSignal as signal,
  startRequest,
} from "./authorizationRoutes.test-helpers";
import { handleCalendarAuthorizationStart } from "./authorizationStartHttp";
import type { GoogleTransport } from "./contracts";

type BrowserOwner = Awaited<ReturnType<typeof calendarRouteUser>>;
export const flowCookieName = (state: string) =>
  `${CALENDAR_OAUTH_BROWSER_COOKIE}_${hashCalendarOAuthToken(state)}`;

function cookiePair(raw: string) {
  const pair = raw.split(";")[0] ?? "";
  const separator = pair.indexOf("=");
  return { name: pair.slice(0, separator), value: pair.slice(separator + 1) };
}

export class BrowserCookieJar {
  private readonly values = new Map<string, string>();

  apply(response: Response, receivedAt = Date.now()): void {
    for (const raw of response.headers.getSetCookie()) {
      const { name, value } = cookiePair(raw);
      const attributes = raw
        .split(";")
        .slice(1)
        .map((part) => part.trim().toLowerCase());
      const expires = attributes.find((part) => part.startsWith("expires="))?.slice(8);
      const maxAge = attributes.find((part) => part.startsWith("max-age="))?.slice(8);
      const validMaxAge = maxAge !== undefined && /^-?\d+$/.test(maxAge);
      const expired = validMaxAge
        ? Number(maxAge) <= 0
        : expires !== undefined && Date.parse(expires) <= receivedAt;
      if (expired) this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  header(ownerCookie: string): string {
    return [ownerCookie, ...[...this.values].map(([name, value]) => `${name}=${value}`)].join("; ");
  }
}

export async function startBrowserFlow(db: Db, owner: BrowserOwner) {
  const response = await handleCalendarAuthorizationStart(db, startRequest(owner), signal(), {
    config: routeConfig,
    baseUrl: routeBaseUrl,
  });
  if (response.status !== 200)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "browser flow start failed");
  const body = (await response.clone().json()) as {
    data: { authorizationUrl: string; expiresAt: string };
  };
  const state = new URL(body.data.authorizationUrl).searchParams.get("state");
  const issued = response.headers.getSetCookie().find((raw) => {
    const pair = cookiePair(raw);
    return pair.name.startsWith(CALENDAR_OAUTH_BROWSER_COOKIE) && pair.value !== "";
  });
  if (state === null || issued === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "browser flow state or cookie missing");
  return { response, state, expiresAt: body.data.expiresAt, issued, cookie: cookiePair(issued) };
}

export function callbackBrowserFlow(
  db: Db,
  owner: BrowserOwner,
  jar: BrowserCookieJar,
  state: string,
  options: {
    query?: Record<string, string>;
    transport?: GoogleTransport;
    signal?: AbortSignal;
  } = {},
): Promise<Response> {
  return handleCalendarAuthorizationCallback(
    db,
    callbackRequest(state, jar.header(owner.cookie), options.query),
    options.signal ?? signal(),
    {
      config: routeConfig,
      baseUrl: routeBaseUrl,
      transport: options.transport ?? calendarTestTransport(),
    },
  );
}

async function waitForBrowserGate<T>(promise: Promise<T>, abort: AbortSignal): Promise<T> {
  abort.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      const reason: unknown = abort.reason;
      reject(
        reason instanceof Error
          ? reason
          : new AppError(ERROR_IDS.DB_INVARIANT, "browser exchange gate aborted"),
      );
    };
    abort.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort !== undefined) abort.removeEventListener("abort", onAbort);
  }
}

export async function blockedBrowserCallback(
  db: Db,
  owner: BrowserOwner,
  jar: BrowserCookieJar,
  state: string,
  identity: Parameters<typeof calendarTestTransport>[0],
) {
  const began = deferredValue<void>();
  const release = deferredValue<void>();
  const deadline = AbortSignal.timeout(3_000);
  const upstream: GoogleTransport = calendarTestTransport(identity);
  const finishing = callbackBrowserFlow(db, owner, jar, state, {
    signal: deadline,
    transport: async (url, init) => {
      if (url.endsWith("/token")) {
        began.resolve();
        await waitForBrowserGate(release.promise, init.signal);
      }
      init.signal.throwIfAborted();
      return upstream(url, init);
    },
  });
  try {
    await waitForBrowserGate(
      Promise.race([
        began.promise,
        finishing.then(() => {
          throw new AppError(ERROR_IDS.DB_INVARIANT, "callback missed browser exchange gate");
        }),
      ]),
      deadline,
    );
  } catch (error) {
    release.resolve();
    await finishing.catch(() => undefined);
    throw error;
  }
  return { finishing, release };
}

export function flowStatus(response: Response): string | null {
  const location = response.headers.get("location");
  return location === null ? null : new URL(location).searchParams.get("googleConnect");
}

export function expectFlowCookie(flow: Awaited<ReturnType<typeof startBrowserFlow>>): void {
  const attributes = flow.issued.toLowerCase();
  expect(attributes).toContain(`expires=${new Date(flow.expiresAt).toUTCString().toLowerCase()}`);
  expect(attributes).not.toContain("max-age=");
  expect(flow.cookie.name).toBe(flowCookieName(flow.state));
  expect(attributes).toContain("httponly");
  expect(attributes).toContain("samesite=lax");
  expect(attributes).toContain(`path=${CALENDAR_OAUTH_CALLBACK_PATH}`);
  expect(attributes.includes("; secure")).toBe(new URL(routeBaseUrl).protocol === "https:");
}
