// @vitest-environment jsdom
import { act, cleanup, configure, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  readerRead,
  readerScope,
  readerTargets,
  resetReaderTransport,
  transportIds,
  transportReport,
  transportTargets,
} from "./deliveryObservationReader.fixtures";
import type {
  listDeliveryObservationReviewTargets,
  readDeliveryObservationReports,
} from "./deliveryObservationTransport.client";
import { useDeliveryObservationReader } from "./useDeliveryObservationReader";

vi.mock("./deliveryObservationTransport.client", () => ({
  readDeliveryObservationReports: vi.fn(),
  listDeliveryObservationReviewTargets: vi.fn(),
  reviewDeliveryObservation: vi.fn(),
}));

beforeEach(() => {
  configure({ asyncUtilTimeout: 500 });
  resetReaderTransport();
});
afterEach(cleanup);
type ReadResult = Awaited<ReturnType<typeof readDeliveryObservationReports>>;

describe("delivery reader native transport lifecycle", () => {
  it("loads the exact source and its report-scoped review targets", async () => {
    const { result } = renderHook(() => useDeliveryObservationReader(readerScope, true));
    await waitFor(() => expect(result.current.reports).toEqual([transportReport]));
    expect(result.current.targets).toEqual(transportTargets);
    expect(readerRead).toHaveBeenCalledExactlyOnceWith(
      { accountId: transportIds.account, sourceMessageId: transportIds.source },
      expect.any(AbortSignal),
    );
    expect(readerTargets).toHaveBeenCalledExactlyOnceWith(
      { accountId: transportIds.account, reportId: transportIds.report },
      expect.any(AbortSignal),
    );
  });

  it("uses the attempt selector for an authoritative outbound reference", async () => {
    const scope = {
      ...readerScope,
      reference: { kind: "attempt" as const, attemptId: transportIds.attempt },
    };
    const { result } = renderHook(() => useDeliveryObservationReader(scope, true));
    await waitFor(() => expect(result.current.reports).toHaveLength(1));
    expect(readerRead).toHaveBeenCalledWith(
      { accountId: transportIds.account, attemptId: transportIds.attempt },
      expect.any(AbortSignal),
    );
  });

  it("preserves the same loaded generation across equivalent object reprops", async () => {
    const { result, rerender } = renderHook((scope) => useDeliveryObservationReader(scope, true), {
      initialProps: readerScope,
    });
    await waitFor(() => expect(result.current.reports).toHaveLength(1));
    const generation = result.current.generation;
    rerender({ ...readerScope, reference: { ...readerScope.reference } });
    expect(result.current.generation).toBe(generation);
    expect(readerRead).toHaveBeenCalledTimes(1);
  });

  it.each(["account", "message", "thread", "selector"] as const)(
    "aborts and discards an old %s scope",
    async (change) => {
      const old = deferred<ReadResult>();
      readerRead.mockReturnValueOnce(old.promise);
      const { result, rerender } = renderHook(
        (scope: Parameters<typeof useDeliveryObservationReader>[0]) =>
          useDeliveryObservationReader(scope, true),
        { initialProps: readerScope },
      );
      await waitFor(() => expect(readerRead).toHaveBeenCalledTimes(1));
      const previousSignal = readerRead.mock.calls[0]?.[1];
      const next =
        change === "account"
          ? { ...readerScope, accountId: transportIds.otherAccount }
          : change === "message"
            ? { ...readerScope, messageId: transportIds.secondAttempt }
            : change === "thread"
              ? { ...readerScope, threadId: transportIds.secondAttempt }
              : {
                  ...readerScope,
                  reference: { kind: "attempt" as const, attemptId: transportIds.attempt },
                };
      readerRead.mockResolvedValueOnce({ ok: true, value: [] });
      rerender(next);
      expect(result.current.reports).toEqual([]);
      expect(previousSignal?.aborted).toBe(true);
      await act(async () => {
        old.resolve({ ok: true, value: [transportReport] });
        await old.promise;
      });
      await waitFor(() => expect(readerRead).toHaveBeenCalledTimes(2));
      expect(result.current.reports).toEqual([]);
      expect(readerTargets).not.toHaveBeenCalled();
    },
  );

  it("does no private read while a reader stack is hidden", async () => {
    const { result, rerender } = renderHook(
      (visible) => useDeliveryObservationReader(readerScope, visible),
      { initialProps: false },
    );
    expect(readerRead).not.toHaveBeenCalled();
    expect(result.current.reports).toEqual([]);
    rerender(true);
    await waitFor(() => expect(result.current.reports).toHaveLength(1));
  });

  it("aborts hidden work and requires a fresh authenticated read when shown again", async () => {
    const old = deferred<ReadResult>();
    readerRead.mockReturnValueOnce(old.promise);
    const { result, rerender } = renderHook(
      (visible) => useDeliveryObservationReader(readerScope, visible),
      { initialProps: true },
    );
    await waitFor(() => expect(readerRead).toHaveBeenCalledTimes(1));
    const signal = readerRead.mock.calls[0]?.[1];
    rerender(false);
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      old.resolve({ ok: true, value: [transportReport] });
      await old.promise;
    });
    expect(result.current.reports).toEqual([]);
    rerender(true);
    await waitFor(() => expect(result.current.reports).toEqual([transportReport]));
    expect(readerRead).toHaveBeenCalledTimes(2);
  });

  it("aborts target loading on unmount and observes its late response", async () => {
    const targets = deferred<Awaited<ReturnType<typeof listDeliveryObservationReviewTargets>>>();
    readerTargets.mockReturnValueOnce(targets.promise);
    const { unmount } = renderHook(() => useDeliveryObservationReader(readerScope, true));
    await waitFor(() => expect(readerTargets).toHaveBeenCalledTimes(1));
    const signal = readerTargets.mock.calls[0]?.[1];
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      targets.resolve({ ok: true, value: transportTargets });
      await targets.promise;
    });
  });

  it.each(["permission", "conflict", "unknown"] as const)(
    "fails closed without retry after a %s read",
    async (error) => {
      readerRead.mockResolvedValueOnce({ ok: false, error });
      const { result } = renderHook(() => useDeliveryObservationReader(readerScope, true));
      await waitFor(() => expect(result.current.error).toBe(error));
      expect(result.current.reports).toEqual([]);
      expect(result.current.targets).toEqual([]);
      expect(readerRead).toHaveBeenCalledTimes(1);
      expect(readerTargets).not.toHaveBeenCalled();
    },
  );

  it("withholds the report when target authority changes during the same read", async () => {
    readerTargets.mockResolvedValueOnce({ ok: false, error: "permission" });
    const { result } = renderHook(() => useDeliveryObservationReader(readerScope, true));
    await waitFor(() => expect(result.current.error).toBe("permission"));
    expect(result.current.reports).toEqual([]);
    expect(result.current.targets).toEqual([]);
  });

  it("keeps a message with no current evidence quiet without fetching targets", async () => {
    readerRead.mockResolvedValueOnce({ ok: true, value: [] });
    const { result } = renderHook(() => useDeliveryObservationReader(readerScope, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.reports).toEqual([]);
    expect(readerTargets).not.toHaveBeenCalled();
  });
});
