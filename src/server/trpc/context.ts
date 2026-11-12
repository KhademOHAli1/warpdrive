import { cookies, headers } from "next/headers";
import { cache } from "react";
import { db } from "@/db/client";
import { type AppContext, createCoreContext } from "./context-core";
import { readRequestCsrf } from "./request-csrf";

export type { AppContext } from "./context-core";

/**
 * Resolve the caller from the session cookie. Costs a session lookup plus actor hydration
 * (user row, permission set, visibility groups).
 *
 * Wrapped in React.cache so a layout, a nested layout, and the page share one hydration per
 * request rather than each paying for its own: /settings/users measured 3 session reads before
 * and 1 after. Outside a React request scope (route handlers, the WS server, the worker, tests)
 * cache() is a pass-through, so behaviour there is unchanged.
 */
export const createContext = cache(async (): Promise<AppContext> => {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  return createCoreContext({ db, cookies: jar, csrf: readRequestCsrf(requestHeaders, jar) });
});
