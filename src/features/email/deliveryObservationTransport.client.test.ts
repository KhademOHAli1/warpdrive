import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listDeliveryObservationReviewTargets,
  readDeliveryObservationReports,
  reviewDeliveryObservation,
} from "./deliveryObservationTransport.client";
import {
  expectCallerAbort,
  transportIds as ids,
  transportAssociatedReport,
  transportReport,
  transportResponse,
  transportReview,
  transportSaved,
  transportTargets,
} from "./deliveryObservationTransport.fixtures";

const { csrf, readCsrf } = vi.hoisted(() => {
  const csrf = { value: "current-csrf" as string | null };
  return { csrf, readCsrf: vi.fn(() => csrf.value) };
});
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: readCsrf }));
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.unstubAllGlobals();
  readCsrf.mockClear();
  csrf.value = "current-csrf";
});

describe("native delivery observation browser transport", () => {
  it.each(["source", "attempt", "targets"] as const)(
    "reads exactly one %s selector with native credentials and no mutation token",
    async (kind) => {
      csrf.value = null;
      const value =
        kind === "targets"
          ? transportTargets
          : [kind === "source" ? transportReport : transportAssociatedReport];
      const request = transportResponse({ ok: true, value });
      const s = signal();
      const result =
        kind === "targets"
          ? await listDeliveryObservationReviewTargets(
              { accountId: ids.account, reportId: ids.report },
              s,
            )
          : await readDeliveryObservationReports(
              kind === "source"
                ? { accountId: ids.account, sourceMessageId: ids.source }
                : { accountId: ids.account, attemptId: ids.attempt },
              s,
            );
      expect(result).toEqual({ ok: true, value });
      const query =
        kind === "source"
          ? `sourceMessageId=${ids.source}`
          : kind === "attempt"
            ? `attemptId=${ids.attempt}`
            : `reportId=${ids.report}`;
      expect(request).toHaveBeenCalledExactlyOnceWith(
        `/api/email/delivery-reports?${query}`,
        expect.objectContaining({
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          signal: s,
          headers: {},
        }),
      );
      expect(readCsrf).not.toHaveBeenCalled();
    },
  );

  it("posts only the exact explicit review and current CSRF token", async () => {
    const request = transportResponse({ ok: true, value: transportSaved });
    const s = signal();
    expect(
      await reviewDeliveryObservation({ accountId: ids.account, input: transportReview }, s),
    ).toEqual({ ok: true, value: transportSaved });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/email/delivery-reports",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        signal: s,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": "current-csrf" },
        body: JSON.stringify(transportReview),
      }),
    );
  });

  it("posts an explicitly confirmed dismissal without inventing a target", async () => {
    const input = {
      reportId: ids.report,
      recipientIndex: 0,
      expectedRevision: 0,
      confirmUnverified: true,
      decision: "dismiss",
    };
    const saved = { revision: 1, decision: "dismissed", target: null };
    const request = transportResponse({ ok: true, value: saved });
    expect(await reviewDeliveryObservation({ accountId: ids.account, input }, signal())).toEqual({
      ok: true,
      value: saved,
    });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/email/delivery-reports",
      expect.objectContaining({ method: "POST", body: JSON.stringify(input) }),
    );
  });

  it.each([null, ""])("does not mutate without a CSRF token: %s", async (token) => {
    csrf.value = token;
    const request = transportResponse({ ok: true, value: transportSaved });
    expect(
      await reviewDeliveryObservation({ accountId: ids.account, input: transportReview }, signal()),
    ).toEqual({ ok: false, error: "permission" });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not cache or coalesce distinct account and selector requests", async () => {
    const request = transportResponse({ ok: true, value: [] });
    await readDeliveryObservationReports(
      { accountId: ids.account, sourceMessageId: ids.source },
      signal(),
    );
    await readDeliveryObservationReports(
      { accountId: ids.otherAccount, sourceMessageId: ids.source },
      signal(),
    );
    await readDeliveryObservationReports(
      { accountId: ids.otherAccount, attemptId: ids.attempt },
      signal(),
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      `/api/email/delivery-reports?sourceMessageId=${ids.source}`,
      `/api/email/delivery-reports?sourceMessageId=${ids.source}`,
      `/api/email/delivery-reports?attemptId=${ids.attempt}`,
    ]);
  });

  it.each([
    [401, "permission"],
    [403, "permission"],
    [404, "not_found"],
    [409, "conflict"],
    [429, "rate_limit"],
    [400, "invalid_input"],
    [408, "unknown"],
    [500, "unknown"],
  ] as const)(
    "maps HTTP %s to finite %s without retrying or accepting a review",
    async (status, error) => {
      const request = transportResponse({ ok: false, error }, status);
      expect(
        await reviewDeliveryObservation(
          { accountId: ids.account, input: transportReview },
          signal(),
        ),
      ).toEqual({ ok: false, error });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("withholds network exception details and performs no automatic retry", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("private upstream address"));
    vi.stubGlobal("fetch", request);
    expect(
      await readDeliveryObservationReports(
        { accountId: ids.account, sourceMessageId: ids.source },
        signal(),
      ),
    ).toEqual({ ok: false, error: "unknown" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["fetch", "json"] as const)(
    "propagates a native AbortError surfaced during %s",
    async (stage) => {
      const reason = new DOMException("Native operation aborted", "AbortError");
      if (stage === "fetch")
        vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(reason));
      else {
        const response = Response.json({});
        vi.spyOn(response, "json").mockRejectedValue(reason);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
      }
      await expect(
        readDeliveryObservationReports(
          { accountId: ids.account, sourceMessageId: ids.source },
          signal(),
        ),
      ).rejects.toBe(reason);
    },
  );

  it.each(["read", "targets", "review"] as const)(
    "propagates caller pre-abort before %s dispatch",
    async (operation) => {
      const request = transportResponse({ ok: true, value: [] });
      const controller = new AbortController();
      const reason = new DOMException("Caller stopped operation", "AbortError");
      controller.abort(reason);
      const pending =
        operation === "review"
          ? reviewDeliveryObservation(
              { accountId: ids.account, input: transportReview },
              controller.signal,
            )
          : operation === "targets"
            ? listDeliveryObservationReviewTargets(
                { accountId: ids.account, reportId: ids.report },
                controller.signal,
              )
            : readDeliveryObservationReports(
                { accountId: ids.account, sourceMessageId: ids.source },
                controller.signal,
              );
      await expect(pending).rejects.toBe(reason);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("aborts promptly even when fetch ignores its signal and later supplies success", async () => {
    let finish: (response: Response) => void = () => {};
    const work = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const request = vi.fn<typeof fetch>().mockReturnValue(work);
    vi.stubGlobal("fetch", request);
    const controller = new AbortController();
    const pending = readDeliveryObservationReports(
      { accountId: ids.account, sourceMessageId: ids.source },
      controller.signal,
    );
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1), { timeout: 500, interval: 1 });
    const reason = new DOMException("Navigated away", "AbortError");
    const observed = expectCallerAbort(pending, reason);
    controller.abort(reason);
    try {
      expect((await observed).outcome).toEqual({ kind: "rejected", error: reason });
    } finally {
      finish(Response.json({ ok: true, value: [transportReport] }));
    }
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not accept stale JSON after the caller aborts during body decoding", async () => {
    let finish: (body: unknown) => void = () => {};
    const body = new Promise<unknown>((resolve) => {
      finish = resolve;
    });
    const response = Response.json({});
    const decode = vi.spyOn(response, "json").mockImplementation(() => body);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));
    const controller = new AbortController();
    const pending = readDeliveryObservationReports(
      { accountId: ids.account, sourceMessageId: ids.source },
      controller.signal,
    );
    await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1), { timeout: 500, interval: 1 });
    const reason = new DOMException("Closed reader", "AbortError");
    const observed = expectCallerAbort(pending, reason);
    controller.abort(reason);
    try {
      expect((await observed).outcome).toEqual({ kind: "rejected", error: reason });
    } finally {
      finish({ ok: true, value: [transportReport] });
    }
  });
});
