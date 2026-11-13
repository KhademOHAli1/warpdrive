import type { Db } from "@/db/client";
import { loadLiveSessionByToken, SESSION_COOKIE } from "@/features/auth/session";
import {
  type LocalePreferenceFallback,
  readLocalePreferenceCookies,
} from "@/features/i18n/localePreferenceCookies";
import type { ReadWebIdentity } from "@/features/release/webIdentity";
import { type HydratedActor, hydrateActor } from "@/server/hydrateActor";
import {
  type RequestCookieSource,
  type RequestCsrfFacts,
  readRequestCsrf,
  requestCookiesFromHeaders,
} from "./request-csrf";

export interface AppContext {
  db: Db;
  session: { userId: string; sessionId: string } | null;
  actor: HydratedActor | null;
  localeFallback?: LocalePreferenceFallback;
  /** Captured by a server request adapter, never deserialized from RPC input. */
  csrf?: RequestCsrfFacts;
  /** Optional process-owned resolver. An independent Core must not report its version as Web. */
  readWebIdentity?: ReadWebIdentity;
}

export interface CoreContextInput {
  db: Db;
  cookies: RequestCookieSource;
  csrf?: RequestCsrfFacts;
  signal?: AbortSignal;
  readWebIdentity?: ReadWebIdentity;
}

/** The same cookie credential and actor hydration used by Next, without request globals/cache. */
export async function createCoreContext(input: CoreContextInput): Promise<AppContext> {
  input.signal?.throwIfAborted();
  const anonymous: AppContext = {
    db: input.db,
    session: null,
    actor: null,
    csrf: input.csrf,
    readWebIdentity: input.readWebIdentity,
  };
  const sid = input.cookies.get(SESSION_COOKIE)?.value ?? null;
  if (sid === null) return anonymous;

  const deadline = AbortSignal.timeout(5000);
  const signal = input.signal === undefined ? deadline : AbortSignal.any([input.signal, deadline]);
  const live = await loadLiveSessionByToken(input.db, sid, signal);
  signal.throwIfAborted();
  if (!live.ok) return anonymous;

  const actor = await hydrateActor(input.db, live.value.userId, signal);
  signal.throwIfAborted();
  return {
    db: input.db,
    session: live.value,
    actor,
    localeFallback: readLocalePreferenceCookies(input.cookies),
    csrf: input.csrf,
    readWebIdentity: input.readWebIdentity,
  };
}

/** HTTP entry points authenticate only the actual request cookie; IDs/actor headers are ignored. */
export function createContextFromRequest(
  request: Request,
  db: Db,
  readWebIdentity?: ReadWebIdentity,
): Promise<AppContext> {
  const cookies = requestCookiesFromHeaders(request.headers);
  return createCoreContext({
    db,
    cookies,
    csrf: readRequestCsrf(request.headers, cookies),
    signal: request.signal,
    readWebIdentity,
  });
}
