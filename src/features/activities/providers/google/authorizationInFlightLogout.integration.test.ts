import { assert, expect, it } from "vitest";
import { calendarProviderAccounts } from "@/db/schema/calendarProviderAccounts";
import { logoutCurrentRequest } from "@/features/auth/better/logoutCurrentRequest";
import { makeTestDb } from "@/test/db";
import { calendarTestTransport, connectTestCalendar, deferredValue } from "./accountTestHelpers";
import { handleCalendarAuthorizationCallback } from "./authorizationCallbackHttp";
import {
  calendarRouteUser,
  callbackRequest,
  routeBaseUrl,
  routeConfig,
  routeSignal,
  startRoute,
} from "./authorizationRoutes.test-helpers";
import type { GoogleTransport } from "./contracts";

it("does not bind an exchanged Calendar grant after the callback's session logs out", async () => {
  const h = await makeTestDb();
  const entered = deferredValue<void>();
  const release = deferredValue<void>();
  let completion: Promise<Response> | null = null;
  try {
    const owner = await calendarRouteUser(h.db);
    await connectTestCalendar(h.db, owner.user.id);
    const before = await h.db.select().from(calendarProviderAccounts);
    const start = await startRoute(h.db, owner);
    const fixture = calendarTestTransport({ subject: "new-account-after-logout" });
    const transport: GoogleTransport = async (url, init) => {
      if (url.endsWith("/token")) {
        entered.resolve();
        await release.promise;
        init.signal.throwIfAborted();
      }
      return fixture(url, init);
    };
    completion = handleCalendarAuthorizationCallback(
      h.db,
      callbackRequest(start.state, start.cookie),
      routeSignal(),
      {
        config: routeConfig,
        baseUrl: routeBaseUrl,
        transport,
      },
    );
    await entered.promise;
    const logout = await logoutCurrentRequest(
      h.db,
      new Request(new URL("/auth/logout", routeBaseUrl), {
        method: "POST",
        headers: {
          origin: new URL(routeBaseUrl).origin,
          cookie: owner.cookie,
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({ csrfToken: owner.csrf }),
      }),
      routeSignal(),
    );
    expect(logout.status).toBe(303);
    release.resolve();
    const response = await completion;
    assert(response.headers.get("location") !== null);
    expect(response.headers.get("location")).not.toContain("googleConnect=connected");
    expect(await h.db.select().from(calendarProviderAccounts)).toEqual(before);
  } finally {
    release.resolve();
    await completion?.catch(() => undefined);
    await h.close();
  }
});
