// @vitest-environment jsdom
import { act, cleanup, configure, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  deferred,
  readerRead,
  readerReview,
  readerScope,
  resetReaderTransport,
  transportAssociatedReport,
  transportIds,
  transportReport,
} from "./deliveryObservationReader.fixtures";
import type { reviewDeliveryObservation } from "./deliveryObservationTransport.client";
import { transportReview, transportSaved } from "./deliveryObservationTransport.fixtures";
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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
type ReviewResult = Awaited<ReturnType<typeof reviewDeliveryObservation>>;

it("returns the saved review before refreshing canonical revisions and reader DTOs", async () => {
  const save = deferred<ReviewResult>();
  const changed = vi.fn();
  readerReview.mockReturnValueOnce(save.promise);
  const { result } = renderHook(() => useDeliveryObservationReader(readerScope, true, changed));
  await waitFor(() => expect(result.current.reports).toEqual([transportReport]));
  vi.useFakeTimers();
  const pending = result.current.onReview(transportReview);
  expect(readerReview).toHaveBeenCalledExactlyOnceWith(
    { accountId: transportIds.account, input: transportReview },
    expect.any(AbortSignal),
  );
  expect(result.current.reports[0]?.recipients[0]?.review.revision).toBe(0);
  expect(changed).not.toHaveBeenCalled();
  save.resolve({ ok: true, value: transportSaved });
  expect(await pending).toEqual({ ok: true, value: transportSaved });
  expect(changed).not.toHaveBeenCalled();
  expect(result.current.reports[0]?.recipients[0]?.review.revision).toBe(0);
  readerRead.mockResolvedValueOnce({ ok: true, value: [transportAssociatedReport] });
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(result.current.reports).toEqual([transportAssociatedReport]);
});

it.each(["permission", "conflict", "not_found"] as const)(
  "does not refresh or autoaccept after a %s review",
  async (error) => {
    readerReview.mockResolvedValueOnce({ ok: false, error });
    const changed = vi.fn();
    const { result } = renderHook(() => useDeliveryObservationReader(readerScope, true, changed));
    await waitFor(() => expect(result.current.reports).toHaveLength(1));
    expect(await result.current.onReview(transportReview)).toEqual({ ok: false, error });
    expect(changed).not.toHaveBeenCalled();
    expect(readerRead).toHaveBeenCalledTimes(1);
    expect(result.current.reports).toEqual([transportReport]);
  },
);

it("requires an authenticated fresh read before a new panel generation may clear a lockout", async () => {
  const { result } = renderHook(() => useDeliveryObservationReader(readerScope, true));
  await waitFor(() => expect(result.current.reports).toHaveLength(1));
  const generation = result.current.generation;
  act(() => result.current.refresh());
  await waitFor(() => expect(readerRead).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.generation).toBeGreaterThan(generation);
});

it.each(["account", "hidden", "unmount"] as const)(
  "discards a late successful review after %s changes",
  async (change) => {
    const save = deferred<ReviewResult>();
    const changed = vi.fn();
    readerReview.mockReturnValueOnce(save.promise);
    const { result, rerender, unmount } = renderHook(
      ({ scope, visible }) => useDeliveryObservationReader(scope, visible, changed),
      { initialProps: { scope: readerScope, visible: true } },
    );
    await waitFor(() => expect(result.current.reports).toHaveLength(1));
    const pending = result.current.onReview(transportReview);
    const observed = pending.catch((error: unknown) => error);
    const signal = readerReview.mock.calls[0]?.[1];
    if (change === "unmount") unmount();
    else
      rerender({
        scope: {
          ...readerScope,
          accountId: change === "account" ? transportIds.otherAccount : readerScope.accountId,
        },
        visible: change !== "hidden",
      });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      save.resolve({ ok: true, value: transportSaved });
      await save.promise;
    });
    expect(await observed).toMatchObject({ name: "AbortError" });
    expect(changed).not.toHaveBeenCalled();
  },
);

it("rejects stale review handlers captured before a new reader scope", async () => {
  const { result, rerender } = renderHook((scope) => useDeliveryObservationReader(scope, true), {
    initialProps: readerScope,
  });
  await waitFor(() => expect(result.current.reports).toHaveLength(1));
  const oldReview = result.current.onReview;
  rerender({ ...readerScope, accountId: transportIds.otherAccount });
  await expect(oldReview(transportReview)).rejects.toMatchObject({ name: "AbortError" });
  expect(readerReview).not.toHaveBeenCalled();
});
