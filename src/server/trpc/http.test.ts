import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { newsletterRouter } from "@/features/newsletter/router";
import type { AppContext } from "./context-core";
import { createTrpcHttpHandler } from "./http";
import { readRequestCsrf } from "./request-csrf";
import { protectedProcedure, router } from "./trpc";

const db = {} as Db;
function context(): AppContext {
  return {
    db,
    session: { userId: "user-one", sessionId: "session-one" },
    actor: {
      id: "user-one",
      type: "admin",
      isActive: true,
      name: "User",
      email: "user@example.test",
      avatarUrl: null,
      flags: new Set(),
      groupIds: new Set(),
      managedUserIds: new Set(),
    },
  };
}
const read = protectedProcedure.query(({ ctx }) => ({
  actorId: ctx.actor.id,
  at: new Date("2026-11-12T12:00:00Z"),
  flags: new Set(["first", "second"]),
}));
const testRouter = router({
  read,
  other: read,
  forbidden: protectedProcedure.query(() => {
    throw new TRPCError({ code: "FORBIDDEN", message: "E_PERM_001" });
  }),
  failure: protectedProcedure.query(() => {
    throw new Error("owned internal failure");
  }),
  mutation: protectedProcedure.mutation(() => "written"),
});
function clientFor(handler: (request: Request) => Promise<Response>) {
  return createTRPCProxyClient<typeof testRouter>({
    links: [
      httpBatchLink({
        url: "https://app.example.com/api/trpc",
        transformer: superjson,
        fetch: (url, init) => handler(new Request(url, init)),
      }),
    ],
  });
}

describe("shared tRPC Fetch transport", () => {
  it("keeps batching, SuperJSON values and a single context per HTTP request", async () => {
    const createContext = vi.fn(() => Promise.resolve(context()));
    const captureError = vi.fn();
    const handler = createTrpcHttpHandler({ router: testRouter, createContext, captureError });
    const client = clientFor(handler);
    const [a, b] = await Promise.all([client.read.query(), client.other.query()]);
    expect(a).toEqual(b);
    expect(a.at).toBeInstanceOf(Date);
    expect(a.flags).toBeInstanceOf(Set);
    expect(a.actorId).toBe("user-one");
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("retains expected unauthorized/forbidden/not-found errors without reporting them as faults", async () => {
    const captureError = vi.fn();
    const unauthorized = createTrpcHttpHandler({
      router: testRouter,
      createContext: () => Promise.resolve({ db, actor: null, session: null }),
      captureError,
    });
    await expect(clientFor(unauthorized).read.query()).rejects.toMatchObject({
      data: { code: "UNAUTHORIZED" },
      message: "E_AUTH_003",
    });
    const handler = createTrpcHttpHandler({
      router: testRouter,
      createContext: () => Promise.resolve(context()),
      captureError,
    });
    await expect(clientFor(handler).forbidden.query()).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
      message: "E_PERM_001",
    });
    const missing = await handler(new Request("https://app.example.com/api/trpc/missing"));
    expect(missing.status).toBe(404);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("keeps timing and context-owned response headers on successful and failed responses", async () => {
    const handler = createTrpcHttpHandler({
      router: testRouter,
      createContext: ({ resHeaders }) => {
        resHeaders.set("x-owned-response", "retained");
        return context();
      },
      captureError: vi.fn(),
    });
    for (const path of ["read", "forbidden", "failure"]) {
      const response = await handler(new Request(`https://app.example.com/api/trpc/${path}`));
      expect(response.headers.get("server-timing")).toMatch(/^trpc;dur=\d+(?:\.\d+)?$/);
      expect(response.headers.get("x-owned-response")).toBe("retained");
    }
  });

  it("reports unexpected errors once with the authenticated actor and same route metadata", async () => {
    const captureError = vi.fn();
    const handler = createTrpcHttpHandler({
      router: testRouter,
      createContext: () => Promise.resolve(context()),
      captureError,
    });
    const response = await handler(new Request("https://app.example.com/api/trpc/failure"));
    expect(response.status).toBe(500);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith("user-one", expect.any(TRPCError), {
      path: "failure",
      route: "trpc",
    });
  });

  it("does not turn failed context creation into an authenticated resolver call or fallback", async () => {
    const resolve = vi.fn(() => "unexpected");
    const isolated = router({ read: protectedProcedure.query(resolve) });
    const createContext = vi.fn(() => Promise.reject(new Error("owned database failure")));
    const captureError = vi.fn();
    const handler = createTrpcHttpHandler({ router: isolated, createContext, captureError });
    const response = await handler(new Request("https://app.example.com/api/trpc/read"));
    expect(response.status).toBe(500);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
    expect(captureError).toHaveBeenCalledWith(null, expect.any(TRPCError), {
      path: "read",
      route: "trpc",
    });
  });

  it("retains POST mutation semantics without repeating the effect", async () => {
    const effect = vi.fn(() => "written");
    const isolated = router({ write: protectedProcedure.mutation(effect) });
    const handler = createTrpcHttpHandler({
      router: isolated,
      createContext: () => Promise.resolve(context()),
      captureError: vi.fn(),
    });
    const response = await handler(
      new Request("https://app.example.com/api/trpc/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: null }),
      }),
    );
    expect(response.status).toBe(200);
    expect(effect).toHaveBeenCalledTimes(1);
  });
});

describe("newsletter request facts gate", () => {
  const command = { operation: "subscribers.create", input: {}, csrfToken: "payload-token" };
  const review = {
    operationId: "3116fb53-c862-4f64-8f05-842f601b11c3",
    outcome: "notApplied" as const,
    evidenceSource: "engineLog" as const,
    evidenceReference: "REVIEW-1",
    csrfToken: "payload-token",
  };

  it("denies missing facts before touching database or provider effects", async () => {
    const touch = vi.fn();
    const guardedDb = new Proxy(db, {
      get() {
        touch();
        throw new Error("database must remain untouched");
      },
    });
    const caller = newsletterRouter.createCaller({ ...context(), db: guardedDb });
    await expect(caller.write(command)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.resolveReceipt(review)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(touch).not.toHaveBeenCalled();
  });

  it("denies invalid facts before touching database or provider effects", async () => {
    const touch = vi.fn();
    const guardedDb = new Proxy(db, {
      get() {
        touch();
        throw new Error("database must remain untouched");
      },
    });
    const csrf = readRequestCsrf(
      new Headers({
        cookie: "wd_csrf=wrong",
        origin: "https://app.example.com",
        host: "app.example.com",
        "sec-fetch-site": "same-origin",
      }),
    );
    const caller = newsletterRouter.createCaller({ ...context(), db: guardedDb, csrf });
    await expect(caller.write(command)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(touch).not.toHaveBeenCalled();
  });
});
