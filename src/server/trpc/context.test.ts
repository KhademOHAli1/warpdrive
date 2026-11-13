import { RequestCookies } from "next/dist/compiled/@edge-runtime/cookies";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { ok } from "@/types/result";
import { createContext } from "./context";
import { createContextFromRequest } from "./context-core";

const deps = vi.hoisted(() => ({
  db: {},
  cookies: vi.fn(),
  headers: vi.fn(),
  load: vi.fn(),
  hydrate: vi.fn(),
  cache: vi.fn((fn: () => unknown) => Object.assign(fn, { unitRequestCacheWrapper: true })),
}));
vi.mock("next/headers", () => ({ cookies: deps.cookies, headers: deps.headers }));
vi.mock("react", () => ({ cache: deps.cache }));
vi.mock("@/db/client", () => ({ db: deps.db }));
vi.mock("@/features/auth/session", () => ({
  SESSION_COOKIE: "wd_sid",
  loadLiveSessionByToken: deps.load,
}));
vi.mock("@/server/hydrateActor", () => ({ hydrateActor: deps.hydrate }));

function source(cookie: string) {
  const headers = new Headers({
    cookie,
    origin: "https://app.example.com",
    host: "app.example.com",
    "sec-fetch-site": "same-origin",
  });
  deps.cookies.mockResolvedValue(new RequestCookies(headers));
  deps.headers.mockResolvedValue(headers);
  return new Request("https://app.example.com/api/trpc/identity.assignableUsers", { headers });
}

beforeEach(() => {
  deps.cookies.mockReset();
  deps.headers.mockReset();
  deps.load.mockReset();
  deps.hydrate.mockReset();
  deps.load.mockImplementation((_db, token: string) =>
    Promise.resolve(ok({ userId: token, sessionId: `session-${token}` })),
  );
  deps.hydrate.mockImplementation((_db, userId: string) =>
    Promise.resolve({
      id: userId,
      type: "regular",
      isActive: true,
      name: userId,
      email: `${userId}@example.test`,
      avatarUrl: null,
      flags: new Set(),
      groupIds: new Set(),
      managedUserIds: new Set(),
    }),
  );
});

describe("cached zero-argument Next context adapter", () => {
  it("retains its React.cache wrapper and existing zero-argument entry", async () => {
    expect(Reflect.get(createContext, "unitRequestCacheWrapper")).toBe(true);
    expect(createContext.length).toBe(0);
    source("wd_sid=one");
    expect((await createContext()).actor?.id).toBe("one");
  });

  it("matches the standard Request adapter for installed-Next cookie semantics and CSRF facts", async () => {
    const request = source(
      "wd_sid=old; wd_sid=latest%2Dtoken; wd_csrf=csrf%2Dvalue; warpdrive_timezone=Europe%2FBerlin; warpdrive_locale=fa",
    );
    const next = await createContext();
    const core = await createContextFromRequest(request, deps.db as Db);
    expect(core).toEqual(next);
    expect(core.actor?.id).toBe("latest-token");
    expect(core.csrf?.cookieToken).toBe("csrf-value");
    expect(core.localeFallback?.timeZone).toBe("Europe/Berlin");
  });

  it("adds no process-wide actor cache outside the React request adapter", async () => {
    source("wd_sid=first");
    const first = await createContext();
    source("wd_sid=second");
    const second = await createContext();
    expect(first.actor?.id).toBe("first");
    expect(second.actor?.id).toBe("second");
    expect(deps.load).toHaveBeenCalledTimes(2);
  });
});
