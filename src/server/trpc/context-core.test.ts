import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import type { HydratedActor } from "@/server/hydrateActor";
import { err, ok } from "@/types/result";
import { createContextFromRequest, createCoreContext } from "./context-core";
import { readRequestCsrf, requestCookiesFromHeaders } from "./request-csrf";

const auth = vi.hoisted(() => ({ load: vi.fn(), hydrate: vi.fn() }));
vi.mock("@/features/auth/session", () => ({
  SESSION_COOKIE: "wd_sid",
  loadLiveSessionByToken: auth.load,
}));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: auth.hydrate }));

const db = {} as Db;
function actor(id: string): HydratedActor {
  return {
    id,
    type: "regular",
    isActive: true,
    name: id,
    email: `${id}@example.test`,
    avatarUrl: null,
    flags: new Set(),
    groupIds: new Set(),
    managedUserIds: new Set(),
  };
}
function request(cookie?: string, signal?: AbortSignal) {
  return new Request("https://app.example.com/api/trpc/identity.assignableUsers", {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      origin: "https://app.example.com",
      host: "app.example.com",
      "sec-fetch-site": "same-origin",
      "x-user-id": "untrusted-admin",
      "x-session-id": "untrusted-internal-id",
    },
    signal,
  });
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  auth.load.mockReset().mockResolvedValue(err("not_found"));
  auth.hydrate.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("portable request authentication context", () => {
  it("installs the process-owned Web resolver for anonymous and authenticated requests", async () => {
    const resolver = vi.fn();
    const anonymous = await createContextFromRequest(request(), db, resolver);
    expect(anonymous.readWebIdentity).toBe(resolver);
    auth.load.mockResolvedValue(ok({ userId: "native-user", sessionId: "internal-handle" }));
    auth.hydrate.mockResolvedValue(actor("native-user"));
    const authenticated = await createContextFromRequest(
      request("wd_sid=credential"),
      db,
      resolver,
    );
    expect(authenticated.readWebIdentity).toBe(resolver);
    expect(resolver).not.toHaveBeenCalled();
    expect((await createContextFromRequest(request(), db)).readWebIdentity).toBeUndefined();
  });
  it("does not treat actor/session headers or an absent cookie as authentication", async () => {
    const context = await createContextFromRequest(request(), db);
    expect(context).toMatchObject({ db, session: null, actor: null });
    expect(auth.load).not.toHaveBeenCalled();
    expect(auth.hydrate).not.toHaveBeenCalled();
    expect(context.csrf).toEqual({
      cookieToken: null,
      origin: "https://app.example.com",
      host: "app.example.com",
      secFetchSite: "same-origin",
    });
  });

  it("uses only the cookie credential and database-derived identity with one shared deadline", async () => {
    const nativeActor = actor("native-user");
    auth.load.mockResolvedValue(ok({ userId: nativeActor.id, sessionId: "internal-handle" }));
    auth.hydrate.mockResolvedValue(nativeActor);
    const context = await createContextFromRequest(
      request(
        "wd_sid=opaque%2Esigned; wd_csrf=csrf; warpdrive_locale=fa; warpdrive_timezone=Europe%2FBerlin",
      ),
      db,
    );
    expect(auth.load).toHaveBeenCalledWith(db, "opaque.signed", expect.any(AbortSignal));
    const loadCall = auth.load.mock.calls[0];
    if (loadCall === undefined) throw new Error("Native session loader was not called");
    const signal: unknown = loadCall[2];
    expect(auth.hydrate).toHaveBeenCalledWith(db, "native-user", signal);
    expect(context.actor).toBe(nativeActor);
    expect(context.session).toEqual({ userId: "native-user", sessionId: "internal-handle" });
    expect(context.localeFallback).toMatchObject({ locale: "fa", timeZone: "Europe/Berlin" });
    expect(context.csrf?.cookieToken).toBe("csrf");
  });

  it("keeps invalid/dead/pending decisions in the real token loader and never hydrates on denial", async () => {
    const context = await createContextFromRequest(request("wd_sid=present-but-refused"), db);
    expect(auth.load).toHaveBeenCalledWith(db, "present-but-refused", expect.any(AbortSignal));
    expect(context.session).toBeNull();
    expect(context.actor).toBeNull();
    expect(auth.hydrate).not.toHaveBeenCalled();
  });

  it("does not manufacture an actor when hydration refuses a live session", async () => {
    auth.load.mockResolvedValue(ok({ userId: "gone-user", sessionId: "session" }));
    const context = await createContextFromRequest(request("wd_sid=credential"), db);
    expect(context.actor).toBeNull();
    expect(context.session?.userId).toBe("gone-user");
  });

  it("matches an equivalent server cookie-reader adapter, including CSRF and locale facts", async () => {
    auth.load.mockResolvedValue(ok({ userId: "same", sessionId: "session" }));
    auth.hydrate.mockResolvedValue(actor("same"));
    const incoming = request(
      "wd_sid=older; wd_sid=latest; wd_csrf=encoded%2Dtoken; warpdrive_locale=de",
    );
    const cookies = requestCookiesFromHeaders(incoming.headers);
    const nextStyle = await createCoreContext({
      db,
      cookies,
      csrf: readRequestCsrf(incoming.headers, cookies),
    });
    const native = await createContextFromRequest(incoming, db);
    expect(native).toEqual(nextStyle);
    expect(auth.load.mock.calls.map((call) => call[1])).toEqual(["latest", "latest"]);
  });

  it("propagates database and hydration errors rather than downgrading them to anonymous", async () => {
    const failure = new Error("owned database failure");
    auth.load.mockRejectedValueOnce(failure);
    await expect(createContextFromRequest(request("wd_sid=credential"), db)).rejects.toBe(failure);
    auth.load.mockResolvedValue(ok({ userId: "same", sessionId: "session" }));
    auth.hydrate.mockRejectedValueOnce(failure);
    await expect(createContextFromRequest(request("wd_sid=credential"), db)).rejects.toBe(failure);
  });

  it("refuses a request aborted before lookup", async () => {
    const reason = new Error("owned request stopped");
    await expect(
      createContextFromRequest(request("wd_sid=credential", AbortSignal.abort(reason)), db),
    ).rejects.toBe(reason);
    expect(auth.load).not.toHaveBeenCalled();
  });

  it("does not continue to hydration when abort arrives during session lookup", async () => {
    const pending = deferred<ReturnType<typeof ok<{ userId: string; sessionId: string }>>>();
    auth.load.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const build = createContextFromRequest(request("wd_sid=credential", controller.signal), db);
    const reason = new Error("owned request stopped");
    controller.abort(reason);
    pending.resolve(ok({ userId: "same", sessionId: "session" }));
    await expect(build).rejects.toBe(reason);
    expect(auth.hydrate).not.toHaveBeenCalled();
  });

  it("enforces the five-second context budget even when a dependency returns after its signal", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const pending = deferred<ReturnType<typeof ok<{ userId: string; sessionId: string }>>>();
    auth.load.mockReturnValueOnce(pending.promise);
    const build = createContextFromRequest(request("wd_sid=credential"), db);
    expect(timeout).toHaveBeenCalledWith(5000);
    const reason = new Error("owned deadline elapsed");
    deadline.abort(reason);
    pending.resolve(ok({ userId: "same", sessionId: "session" }));
    await expect(build).rejects.toBe(reason);
    expect(auth.hydrate).not.toHaveBeenCalled();
  });

  it("keeps interleaved requests and their actor/CSRF/locale data separate", async () => {
    const first = deferred<ReturnType<typeof ok<{ userId: string; sessionId: string }>>>();
    const second = deferred<ReturnType<typeof ok<{ userId: string; sessionId: string }>>>();
    auth.load.mockImplementation((_db, token) =>
      token === "one" ? first.promise : second.promise,
    );
    auth.hydrate.mockImplementation((_db, userId: string) => Promise.resolve(actor(userId)));
    const one = createContextFromRequest(
      request("wd_sid=one; wd_csrf=first; warpdrive_locale=fa"),
      db,
    );
    const two = createContextFromRequest(
      request("wd_sid=two; wd_csrf=second; warpdrive_locale=de"),
      db,
    );
    second.resolve(ok({ userId: "user-two", sessionId: "session-two" }));
    first.resolve(ok({ userId: "user-one", sessionId: "session-one" }));
    const [a, b] = await Promise.all([one, two]);
    expect(a.actor?.id).toBe("user-one");
    expect(b.actor?.id).toBe("user-two");
    expect(a.csrf?.cookieToken).toBe("first");
    expect(b.csrf?.cookieToken).toBe("second");
    expect(a.localeFallback?.locale).toBe("fa");
    expect(b.localeFallback?.locale).toBe("de");
  });
});
