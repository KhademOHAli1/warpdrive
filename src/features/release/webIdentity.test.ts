import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { ok } from "@/types/result";
import { computeStatus } from "./computeStatus";
import {
  createWebIdentityReader,
  declareWebIdentity,
  WEB_IDENTITY_PATH,
  webIdentitySchema,
} from "./webIdentity";

function response(version = "2.1.0"): Response {
  return Response.json(declareWebIdentity(version, "a".repeat(40)));
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("versioned Web identity", () => {
  it("keeps source declarations distinct from installed image identity", () => {
    expect(declareWebIdentity("dev", "unstamped")).toEqual({
      contract: "warpdrive.web.identity.v1",
      component: "web",
      version: "dev",
      sourceRevision: null,
    });
    const web = declareWebIdentity("2.1.0", "a".repeat(40));
    expect(webIdentitySchema.safeParse({ ...web, component: "core-api" }).success).toBe(false);
    expect(
      webIdentitySchema.safeParse({ ...web, contract: "warpdrive.web.identity.v2" }).success,
    ).toBe(false);
    expect(webIdentitySchema.safeParse({ ...web, credential: "unwanted" }).success).toBe(false);
    expect(webIdentitySchema.safeParse({ ...web, version: "not-a-version" }).success).toBe(false);
  });

  it("uses one fixed read-only endpoint without forwarding caller credentials", async () => {
    const fetchIdentity = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 100,
      cacheMs: 100,
      fetch: fetchIdentity,
    });
    expect(await reader.read()).toEqual(ok(declareWebIdentity("2.1.0", "a".repeat(40))));
    expect(fetchIdentity).toHaveBeenCalledWith(`http://app:3000${WEB_IDENTITY_PATH}`, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    });
    await reader.close();
  });

  it("rejects invalid operator origins and budgets before any request", () => {
    for (const origin of [
      "file:///tmp/web",
      "http://user:secret@app:3000",
      "http://app:3000/other",
      "http://app:3000/?query=1",
      "http://app:3000/#fragment",
    ])
      expect(() => createWebIdentityReader({ origin, timeoutMs: 100, cacheMs: 100 })).toThrow();
    for (const timeoutMs of [0, -1, 5001, Number.NaN])
      expect(() =>
        createWebIdentityReader({ origin: "http://app:3000", timeoutMs, cacheMs: 100 }),
      ).toThrow();
  });

  it("reflects an independently changed Web version without restarting Core or changing legacy DTOs", async () => {
    let time = 0;
    const fetchIdentity = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("2.1.0"))
      .mockResolvedValueOnce(response("2.2.0"));
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 100,
      cacheMs: 10,
      now: () => time,
      fetch: fetchIdentity,
    });
    const first = await reader.read();
    expect(first).toEqual(ok(declareWebIdentity("2.1.0", "a".repeat(40))));
    expect(await reader.read()).toEqual(first);
    expect(fetchIdentity).toHaveBeenCalledTimes(1);
    time = 11;
    const second = await reader.read();
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("Expected current Web identity");
    expect(computeStatus(second.value.version, null, false)).toEqual({
      current: "2.2.0",
      latest: null,
      releaseUrl: null,
      releaseNotes: null,
      updateAvailable: null,
      checkedAt: null,
      disabled: false,
    });
    expect(fetchIdentity).toHaveBeenCalledTimes(2);
    await reader.close();
  });

  it("rejects wrong contracts, redirects, oversized and truncated responses", async () => {
    const bodies = [
      new Response("{}", { headers: { "content-type": "application/json" } }),
      new Response("redirect", { status: 302 }),
      new Response("html", { headers: { "content-type": "text/html" } }),
      new Response("x".repeat(1025), { headers: { "content-type": "application/json" } }),
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "1025" },
      }),
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "3" },
      }),
    ];
    for (const body of bodies) {
      const reader = createWebIdentityReader({
        origin: "http://app:3000",
        timeoutMs: 100,
        cacheMs: 0,
        fetch: () => Promise.resolve(body),
      });
      expect(await reader.read()).toEqual({ ok: false, error: "incompatible" });
      await reader.close();
    }
  });

  it("accepts a bounded transparently decoded response without comparing its encoded length", async () => {
    const identity = declareWebIdentity("2.1.0", "a".repeat(40));
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 100,
      cacheMs: 0,
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(identity), {
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
              // Fetch exposes decoded bytes while this header describes the encoded body.
              "content-length": "1200",
            },
          }),
        ),
    });
    expect(await reader.read()).toEqual(ok(identity));
    await reader.close();
  });

  it("still caps decoded bytes when an encoded response declares a smaller length", async () => {
    const identity = JSON.stringify(declareWebIdentity("2.1.0", "a".repeat(40)));
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 100,
      cacheMs: 0,
      fetch: () =>
        Promise.resolve(
          new Response(identity.padEnd(1025, " "), {
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
              "content-length": "100",
            },
          }),
        ),
    });
    expect(await reader.read()).toEqual({ ok: false, error: "incompatible" });
    await reader.close();
  });

  it("rejects a fetch that settles past the monotonic deadline before its timer runs", async () => {
    let time = 0;
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 20,
      cacheMs: 0,
      now: () => time,
      fetch: () => {
        time = 21;
        return Promise.resolve(response("9.9.9"));
      },
    });
    expect(await reader.read()).toEqual({ ok: false, error: "timeout" });
    await reader.close();
  });

  it("checks elapsed time while buffered empty chunks keep the timer from running", async () => {
    let time = 0;
    let pulls = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls <= 3) {
            time += 7;
            controller.enqueue(new Uint8Array());
          } else {
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify(declareWebIdentity("9.9.9", "a".repeat(40)))),
            );
            controller.close();
          }
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 20,
      cacheMs: 0,
      now: () => time,
      fetch: () =>
        Promise.resolve(new Response(body, { headers: { "content-type": "application/json" } })),
    });
    expect(await reader.read()).toEqual({ ok: false, error: "timeout" });
    expect(pulls).toBe(3);
    expect(cancel).toHaveBeenCalledTimes(1);
    await reader.close();
  });

  it("checks the deadline again before accepting a decoded identity", async () => {
    let time = 0;
    const parse = JSON.parse;
    const parser = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
      const value: unknown = parse(text, reviver);
      time = 21;
      return value;
    });
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 20,
      cacheMs: 0,
      now: () => time,
      fetch: () => Promise.resolve(response("9.9.9")),
    });
    try {
      expect(await reader.read()).toEqual({ ok: false, error: "timeout" });
    } finally {
      parser.mockRestore();
      await reader.close();
    }
  });

  it("keeps ownership while cancellation of an actual response is unresolved", async () => {
    vi.useFakeTimers();
    const cancellation = deferred<void>();
    const cancel = vi.fn(() => cancellation.promise);
    const fetchIdentity = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(new ReadableStream({ cancel }), { status: 503 })),
    );
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 20,
      cacheMs: 0,
      fetch: fetchIdentity,
    });
    const first = reader.read();
    let closed = false;
    let closing: Promise<void> | undefined;
    try {
      await vi.advanceTimersByTimeAsync(21);
      expect(await first).toEqual({ ok: false, error: "timeout" });
      expect(await reader.read()).toEqual({ ok: false, error: "timeout" });
      expect(fetchIdentity).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      closing = reader.close().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
    } finally {
      cancellation.resolve();
      await (closing ?? reader.close());
    }
    expect(closed).toBe(true);
  });

  it("retains the slot and fails close safely when actual response cancellation rejects", async () => {
    const diagnostic = "generated-sensitive-cancellation-diagnostic";
    const fetchIdentity = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(new ReadableStream({ cancel: () => Promise.reject(new Error(diagnostic)) }), {
          status: 503,
        }),
      )
      .mockImplementation(() => Promise.resolve(response("9.9.9")));
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 20,
      cacheMs: 0,
      fetch: fetchIdentity,
    });
    expect(await reader.read()).toEqual({ ok: false, error: "incompatible" });
    // Let completed-work finalizers run: a rejected cancellation must still retain this slot.
    await Promise.resolve();
    await Promise.resolve();
    expect(await reader.read()).toEqual({ ok: false, error: "incompatible" });
    expect(fetchIdentity).toHaveBeenCalledTimes(1);
    const closing = reader.close();
    await expect(closing).rejects.toBeInstanceOf(AppError);
    await expect(closing).rejects.toMatchObject({
      id: ERROR_IDS.RUNTIME_CORE_API_STREAM_UNSETTLED,
    });
    await expect(closing).rejects.toThrow("Web identity transport cleanup incomplete");
    await expect(closing).rejects.not.toThrow(diagnostic);
    expect(await reader.read()).toEqual({ ok: false, error: "closed" });
  });

  it("holds the sole transport slot through an abort-ignoring timeout and rejects late identity", async () => {
    vi.useFakeTimers();
    const transport = deferred<Response>();
    const fetchIdentity = vi.fn<typeof fetch>(() => transport.promise);
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 20,
      cacheMs: 100,
      fetch: fetchIdentity,
    });
    const first = reader.read();
    const second = reader.read();
    await vi.advanceTimersByTimeAsync(21);
    expect(await first).toEqual({ ok: false, error: "timeout" });
    expect(await second).toEqual({ ok: false, error: "timeout" });
    expect(await reader.read()).toEqual({ ok: false, error: "timeout" });
    expect(fetchIdentity).toHaveBeenCalledTimes(1);
    let closed = false;
    const closing = reader.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    transport.resolve(response("9.9.9"));
    await closing;
    expect(closed).toBe(true);
    expect(await reader.read()).toEqual({ ok: false, error: "closed" });
    expect(fetchIdentity).toHaveBeenCalledTimes(1);
  });

  it("aborts one caller without cancelling the shared public metadata read", async () => {
    const transport = deferred<Response>();
    const fetchIdentity = vi.fn<typeof fetch>(() => transport.promise);
    const reader = createWebIdentityReader({
      origin: "http://app:3000",
      timeoutMs: 100,
      cacheMs: 100,
      fetch: fetchIdentity,
    });
    const controller = new AbortController();
    const one = reader.read(controller.signal);
    const two = reader.read();
    controller.abort();
    expect(await one).toEqual({ ok: false, error: "aborted" });
    transport.resolve(response());
    expect(await two).toEqual(ok(declareWebIdentity("2.1.0", "a".repeat(40))));
    expect(fetchIdentity).toHaveBeenCalledTimes(1);
    await reader.close();
  });
});
