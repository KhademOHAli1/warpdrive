import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { withTestDb } from "@/db/testing";
import { ok } from "@/types/result";
import { createDeliveryObservationHttp } from "./deliveryObservationHttp";
import {
  type MailSessionFixtureOptions,
  seedMailHttpSession,
} from "./mailConnectionHttp.test-helpers";

const input = () => ({
  reportId: randomUUID(),
  recipientIndex: 0,
  expectedRevision: 0,
  decision: "dismiss",
  confirmUnverified: true,
});
const saved = { revision: 1, decision: "dismissed" as const, target: null };
const reviewer = () => vi.fn(() => Promise.resolve(ok(saved)));

function post(origin: string, headers: Headers, body: unknown = input()) {
  return new Request(`${origin}/api/email/delivery-reports`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("native delivery review HTTP boundary", () => {
  it("accepts a normal valid session without adding a fresh-auth challenge", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db, { freshAt: new Date(Date.now() - 3_600_000) });
      const review = reviewer();
      const body = input();
      const response = await createDeliveryObservationHttp(db, { review })(
        post(f.origin, f.headers, body),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(ok(saved));
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(review).toHaveBeenCalledExactlyOnceWith(db, f.context, body, expect.any(AbortSignal));
    });
  });

  it.each([
    ["pending MFA", { assurance: "pending" }],
    ["unverified", { emailVerified: false }],
    ["inactive", { isActive: false }],
    ["expired", { expiresAt: new Date(Date.now() - 1000) }],
    ["administrator password below MFA policy", { isAdmin: true }],
  ] satisfies [string, MailSessionFixtureOptions][])(
    "rejects %s before review dispatch",
    async (_label, options) => {
      await withTestDb(async (db) => {
        const f = await seedMailHttpSession(db, options);
        const review = reviewer();
        const response = await createDeliveryObservationHttp(db, { review })(
          post(f.origin, f.headers),
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ ok: false, error: "permission" });
        expect(review).not.toHaveBeenCalled();
      });
    },
  );

  it.each(["csrf", "origin", "cross-site", "content-type"])(
    "requires the existing %s boundary",
    async (reason) => {
      await withTestDb(async (db) => {
        const f = await seedMailHttpSession(db);
        const headers = new Headers(f.headers);
        if (reason === "csrf") headers.set("x-csrf-token", "forged");
        if (reason === "origin") headers.set("origin", "https://untrusted.example.test");
        if (reason === "cross-site") headers.set("sec-fetch-site", "cross-site");
        if (reason === "content-type") headers.set("content-type", "text/plain");
        const review = reviewer();
        const response = await createDeliveryObservationHttp(db, { review })(
          post(f.origin, headers),
        );
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ ok: false, error: "permission" });
        expect(review).not.toHaveBeenCalled();
      });
    },
  );

  it("returns no report details or counts to an unauthenticated read", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const readSource = vi.fn(() => Promise.resolve(ok([])));
      const response = await createDeliveryObservationHttp(db, { readSource })(
        new Request(`${f.origin}/api/email/delivery-reports?sourceMessageId=${randomUUID()}`),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: "permission" });
      expect(readSource).not.toHaveBeenCalled();
    });
  });

  it("keeps read responses private and supplies the established CSRF cookie when needed", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const headers = new Headers(f.headers);
      headers.set("cookie", (headers.get("cookie") ?? "").split(";")[0] ?? "");
      const readSource = vi.fn(() => Promise.resolve(ok([])));
      const sourceMessageId = randomUUID();
      const response = await createDeliveryObservationHttp(db, { readSource })(
        new Request(`${f.origin}/api/email/delivery-reports?sourceMessageId=${sourceMessageId}`, {
          headers,
        }),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(ok([]));
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("set-cookie")).toContain("wd_csrf=");
      expect(readSource).toHaveBeenCalledExactlyOnceWith(
        db,
        {
          actor: expect.objectContaining({ id: f.user.id, type: "regular", isActive: true }),
          sourceMessageId,
        },
        expect.any(AbortSignal),
      );
    });
  });

  it("takes a shared atomic per-actor review budget in real PostgreSQL", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const review = reviewer();
      const handle = createDeliveryObservationHttp(db, { review });
      for (let index = 0; index < 20; index++)
        expect((await handle(post(f.origin, f.headers))).status).toBe(200);
      const denied = await handle(post(f.origin, f.headers));
      expect(denied.status).toBe(429);
      expect(await denied.json()).toEqual({ ok: false, error: "rate_limit" });
      expect(review).toHaveBeenCalledTimes(20);
    });
  });

  it("never serializes storage exception messages or a diagnostic stack", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const response = await createDeliveryObservationHttp(db, {
        review: () => Promise.reject(new Error("postgres://synthetic:secret@private/report-body")),
      })(post(f.origin, f.headers));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ ok: false, error: "unknown" });
    });
  });

  it("limits actual streamed bytes even when the declared content length is false", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const review = reviewer();
      const headers = new Headers(f.headers);
      headers.set("content-length", "1");
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(JSON.stringify({ text: "ف".repeat(20_000) })),
          );
        },
        cancel() {
          cancelled = true;
        },
      });
      const init: RequestInit & { duplex: "half" } = {
        method: "POST",
        headers,
        body,
        duplex: "half",
      };
      const response = await createDeliveryObservationHttp(db, { review })(
        new Request(`${f.origin}/api/email/delivery-reports`, init),
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
      expect(cancelled).toBe(true);
      expect(review).not.toHaveBeenCalled();
    });
  });

  it("does not hang when an injected operation ignores its bounded deadline", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const pending = createDeliveryObservationHttp(db, {
        timeoutMs: 100,
        review: () => new Promise(() => {}),
      })(post(f.origin, f.headers));
      const response = await Promise.race([
        pending,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
      expect(response).toBeInstanceOf(Response);
      expect(response?.status).toBe(408);
      expect(await response?.json()).toEqual({ ok: false, error: "unknown" });
    });
  });

  it("propagates an already-aborted caller request without dispatch or an extra unhandled rejection", async () => {
    await withTestDb(async (db) => {
      const f = await seedMailHttpSession(db);
      const review = reviewer();
      const controller = new AbortController();
      const reason = new DOMException("Caller stopped request", "AbortError");
      controller.abort(reason);
      const request = new Request(post(f.origin, f.headers), { signal: controller.signal });
      const unhandled: unknown[] = [];
      const observeUnhandled = (error: unknown) => {
        unhandled.push(error);
      };
      process.on("unhandledRejection", observeUnhandled);
      try {
        const pending = createDeliveryObservationHttp(db, { review })(request);
        await expect(pending).rejects.toBe(reason);
        // A full event-loop turn observes promises rejected outside the returned operation.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        expect(review).not.toHaveBeenCalled();
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", observeUnhandled);
      }
    });
  });
});
