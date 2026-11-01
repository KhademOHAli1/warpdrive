import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { AUTH_RATE_LIMITS, enforceAuthRateLimit } from "@/features/auth/better/rateLimit";
import { err } from "@/types/result";
import { seedMailHttpSession } from "./mailConnectionHttp.test-helpers";
import { createPrivateIntakeHttp } from "./privateIntakeHttp";
import {
  boundedPrivateHttp,
  invalidPrivateIntakeBodies,
  invalidPrivateIntakeQueries,
  observePrivateHttpRejections,
  oversizedPrivateHttpRequest,
  privateHttpDeferred,
  seedForeignPrivateHttpOwner,
  withPrivateIntakeHttp,
} from "./privateIntakeHttp.test-helpers";
import { readPrivateIntake, reviewPrivateIntake } from "./privateIntakeReview";
import type { PrivateIntakeReviewResult } from "./privateIntakeTypes";

it("reads a closed owner summary and saves a local review without credential or MFA freshness", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const before = await f.snapshot();
    const headers = new Headers(f.owner.headers);
    headers.set("cookie", (headers.get("cookie") ?? "").split(";")[0] ?? "");
    const handle = createPrivateIntakeHttp(f.db);
    const read = await handle(f.get(headers));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ ok: true, value: f.summary });
    expect(read.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(read.headers.get("referrer-policy")).toBe("no-referrer");
    expect(read.headers.get("set-cookie")).toMatch(/wd_csrf=.+; Path=\/;.*SameSite=lax/i);
    expect(read.headers.get("set-cookie")).not.toContain("HttpOnly");
    const saved = await handle(f.post());
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      ok: true,
      value: { ...f.summary, revision: 1, decision: "keep_private" },
    });
    expect(saved.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(saved.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await f.snapshot()).protected).toEqual(before.protected);
  });
});

it.each([false, true])(
  "hides private intake from a valid foreign owner (admin=%s)",
  async (isAdmin) => {
    await withPrivateIntakeHttp(async (f) => {
      const stranger = await seedForeignPrivateHttpOwner(f.db, f.signal, isAdmin);
      const before = await f.snapshot();
      const handle = createPrivateIntakeHttp(f.db);
      for (const request of [f.get(stranger.headers), f.post(f.input, stranger.headers)]) {
        const response = await handle(request);
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual({ ok: false, error: "not_found" });
      }
      expect(await f.snapshot()).toEqual(before);
    });
  },
);

it("rejects absent, pending and revoked native sessions before private read dispatch", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const read = vi.fn(readPrivateIntake);
    const handle = createPrivateIntakeHttp(f.db, { read });
    const pending = await seedMailHttpSession(f.db, { assurance: "pending" });
    const revoked = await seedMailHttpSession(f.db);
    await f.db.execute(
      sql`UPDATE sessions SET revoked_at=now() WHERE id=${revoked.context.sessionId}`,
    );
    const before = await f.snapshot();
    for (const headers of [new Headers(), pending.headers, revoked.headers]) {
      const response = await handle(f.get(headers));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: "forbidden" });
    }
    expect(read).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });
});

it("enforces CSRF, same-origin, fetch-site and JSON media type without ledger changes", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const review = vi.fn(reviewPrivateIntake);
    const handle = createPrivateIntakeHttp(f.db, { review });
    const before = await f.snapshot();
    for (const [key, value] of [
      ["x-csrf-token", "forged"],
      ["origin", "https://untrusted.example.test"],
      ["sec-fetch-site", "cross-site"],
      ["content-type", "text/plain"],
    ] as const) {
      const headers = new Headers(f.owner.headers);
      headers.set(key, value);
      const response = await handle(f.post(f.input, headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: "forbidden" });
    }
    expect(review).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });
});

it("requires exactly two named GUID query selectors without duplicates or extras", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const read = vi.fn(readPrivateIntake);
    const before = await f.snapshot();
    for (const query of invalidPrivateIntakeQueries(f.scope)) {
      const response = await createPrivateIntakeHttp(f.db, { read })(f.get(f.owner.headers, query));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(read).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });
});

it("rejects malformed and non-strict POST input before domain dispatch", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const review = vi.fn(reviewPrivateIntake);
    const handle = createPrivateIntakeHttp(f.db, { review });
    const before = await f.snapshot();
    const requests = invalidPrivateIntakeBodies(f.input).map((body) => f.post(body));
    requests.push(new Request(f.post(), { body: "{broken" }));
    for (const request of requests) {
      const response = await handle(request);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(review).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });
});

it("bounds actual UTF-8 streamed bytes despite a false content length and cancels the stream", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const review = vi.fn(reviewPrivateIntake);
    const stream = oversizedPrivateHttpRequest(f.post());
    const before = await f.snapshot();
    const response = await createPrivateIntakeHttp(f.db, { review })(stream.request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_input" });
    expect(stream.wasCancelled()).toBe(true);
    expect(review).not.toHaveBeenCalled();
    expect(await f.snapshot()).toEqual(before);
  });
});

it("propagates an already-aborted request with zero domain or rate dispatch and no orphan rejection", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const read = vi.fn(readPrivateIntake),
      review = vi.fn(reviewPrivateIntake),
      rateLimit = vi.fn(enforceAuthRateLimit);
    const controller = new AbortController();
    const reason = new DOMException("Caller stopped request", "AbortError");
    controller.abort(reason);
    const before = await f.snapshot();
    const unhandled = await observePrivateHttpRejections(async () => {
      await expect(
        createPrivateIntakeHttp(f.db, { read, review, rateLimit })(
          new Request(f.post(), { signal: controller.signal }),
        ),
      ).rejects.toBe(reason);
    });
    expect(read).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
    expect(rateLimit).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
    expect(await f.snapshot()).toEqual(before);
  });
});

it("returns a finite 408 when domain I/O ignores its deadline", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const review = vi.fn<typeof reviewPrivateIntake>(
      () => new Promise<PrivateIntakeReviewResult>(() => {}),
    );
    const before = await f.snapshot();
    const response = await boundedPrivateHttp(
      createPrivateIntakeHttp(f.db, { review, timeoutMs: 100 })(f.post()),
    );
    expect(response).toBeInstanceOf(Response);
    expect(response?.status).toBe(408);
    expect(await response?.json()).toEqual({ ok: false, error: "unavailable" });
    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0]?.[3].aborted).toBe(true);
    expect(await f.snapshot()).toEqual(before);
  });
});

it("aborts entered domain work on caller cancellation and observes a late provider rejection", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const entered = privateHttpDeferred<AbortSignal>();
    const work = privateHttpDeferred<PrivateIntakeReviewResult>();
    const review = vi.fn<typeof reviewPrivateIntake>((_db, _context, _input, signal) => {
      entered.resolve(signal);
      return work.promise;
    });
    const controller = new AbortController();
    const reason = new DOMException("Caller cancelled", "AbortError");
    const before = await f.snapshot();
    const unhandled = await observePrivateHttpRejections(async () => {
      const pending = createPrivateIntakeHttp(f.db, { review })(
        new Request(f.post(), { signal: controller.signal }),
      );
      const observed = pending.then(
        (value) => value,
        (error: unknown) => error,
      );
      try {
        const signal = await boundedPrivateHttp(entered.promise);
        expect(signal).toBeInstanceOf(AbortSignal);
        controller.abort(reason);
        expect(await boundedPrivateHttp(observed)).toBe(reason);
        expect(signal?.aborted).toBe(true);
      } finally {
        controller.abort(reason);
        if (review.mock.calls.length > 0)
          work.reject(new AppError(ERROR_IDS.DB_WRITE_FAILED, "private provider credentials"));
        else work.resolve(err("unavailable"));
        await boundedPrivateHttp(observed);
      }
    });
    expect(unhandled).toEqual([]);
    expect(await f.snapshot()).toEqual(before);
  });
});

it("uses the real atomic per-actor POST budget and denies the next request without a review", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const review = vi.fn(reviewPrivateIntake);
    const handle = createPrivateIntakeHttp(f.db, { review });
    for (let revision = 0; revision < AUTH_RATE_LIMITS.sensitiveAttempts; revision++) {
      const response = await handle(f.post({ ...f.input, expectedRevision: revision }));
      expect(response.status).toBe(200);
    }
    const before = await f.snapshot();
    const denied = await handle(
      f.post({ ...f.input, expectedRevision: AUTH_RATE_LIMITS.sensitiveAttempts }),
    );
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ ok: false, error: "rate_limit" });
    expect(review).toHaveBeenCalledTimes(AUTH_RATE_LIMITS.sensitiveAttempts);
    expect(await f.snapshot()).toEqual(before);
  });
});

it("maps actual missing and stale-CAS results plus finite forbidden/unavailable without leaking evidence", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const before = await f.snapshot();
    const handle = createPrivateIntakeHttp(f.db);
    const missing = await handle(
      f.get(
        f.owner.headers,
        new URLSearchParams({ ...f.scope, intakeId: randomUUID() }).toString(),
      ),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: "not_found" });
    const stale = await handle(f.post({ ...f.input, expectedRevision: 7 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ ok: false, error: "conflict" });
    for (const [error, status] of [
      ["forbidden", 403],
      ["unavailable", 500],
    ] as const) {
      const response = await createPrivateIntakeHttp(f.db, {
        review: () => Promise.resolve(err(error)),
      })(f.post());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, error });
    }
    expect(await f.snapshot()).toEqual(before);
  });
});

it("sanitizes thrown database/auth/provider details into the closed unavailable response", async () => {
  await withPrivateIntakeHttp(async (f) => {
    const before = await f.snapshot();
    const response = await createPrivateIntakeHttp(f.db, {
      review: () =>
        Promise.reject(
          new AppError(ERROR_IDS.DB_WRITE_FAILED, "postgres://synthetic:secret@private/body", {
            token: "private-auth",
            stack: "provider trace",
          }),
        ),
    })(f.post());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
    expect(await f.snapshot()).toEqual(before);
  });
});
