// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred } from "./deliveryObservationReader.fixtures";
import {
  privateReaderIds,
  privateReaderInvalidate,
  privateReaderRead,
  privateReaderReview,
  privateReaderSummary,
  privateReaderUtils,
  renderPrivateReader,
  resetPrivateReader,
} from "./privateIntakeReader.fixtures";
import type { PrivateIntakeReviewResult } from "./privateIntakeTypes";

vi.mock("./privateIntakeTransport.client", () => ({
  readPrivateIntakeSummary: vi.fn(),
  reviewPrivateIntakeSummary: vi.fn(),
}));
vi.mock("@/lib/trpc-client", () => ({ trpc: { useUtils: () => privateReaderUtils } }));
beforeEach(() => {
  configure({ asyncUtilTimeout: 500 });
  resetPrivateReader();
});
afterEach(cleanup);

it.each(["account", "thread", "message", "intake", "unmount"] as const)(
  "aborts an old private review after %s changes and ignores its late success",
  async (change) => {
    const save = deferred<PrivateIntakeReviewResult>();
    privateReaderReview.mockReturnValueOnce(save.promise);
    const f = renderPrivateReader();
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    await f.user.click(screen.getByRole("button", { name: "Keep private" }));
    const signal = privateReaderReview.mock.calls[0]?.[1];
    if (change === "account") f.update({ accountId: privateReaderIds.otherAccount });
    if (change === "thread") f.update({ threadId: privateReaderIds.otherAccount });
    if (change === "message") f.update({ messageId: privateReaderIds.otherAccount });
    if (change === "intake")
      f.update({ summary: { ...privateReaderSummary, id: privateReaderIds.otherIntake } });
    if (change === "unmount") f.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      save.resolve({
        ok: true,
        value: { ...privateReaderSummary, revision: 5, decision: "keep_private" },
      });
      await save.promise;
    });
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(screen.queryByText("Review saved")).toBeNull();
  },
);

it("cancels and closes an actual portaled review when its mounted ancestor becomes hidden/inert", async () => {
  const save = deferred<PrivateIntakeReviewResult>();
  privateReaderReview.mockReturnValueOnce(save.promise);
  const f = renderPrivateReader();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  const signal = privateReaderReview.mock.calls[0]?.[1];
  f.hide();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    save.resolve({ ok: true, value: { ...privateReaderSummary, revision: 5 } });
    await save.promise;
  });
  f.show();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
  expect(privateReaderRead).not.toHaveBeenCalled();
  expect(privateReaderInvalidate).not.toHaveBeenCalled();
});

it("does not mistake modal aria-hidden background for an inactive reader", async () => {
  const save = deferred<PrivateIntakeReviewResult>();
  privateReaderReview.mockReturnValueOnce(save.promise);
  const f = renderPrivateReader();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  const signal = privateReaderReview.mock.calls[0]?.[1];
  await act(() => Promise.resolve());
  expect(signal?.aborted).toBe(false);
  await act(async () => {
    save.resolve({ ok: true, value: { ...privateReaderSummary, revision: 5 } });
    await save.promise;
  });
  expect(screen.getByRole("status")).toHaveTextContent("Review saved");
});

it("aborts a private fresh read on hidden collapse and ignores its late canonical result", async () => {
  privateReaderReview.mockResolvedValueOnce({ ok: false, error: "conflict" });
  const read = deferred<PrivateIntakeReviewResult>();
  privateReaderRead.mockReturnValueOnce(read.promise);
  const f = renderPrivateReader();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await screen.findByRole("alert");
  await f.user.click(screen.getByRole("button", { name: "Refresh review" }));
  const signal = privateReaderRead.mock.calls[0]?.[1];
  f.hide();
  await waitFor(() => expect(signal?.aborted).toBe(true));
  await act(async () => {
    read.resolve({ ok: true, value: { ...privateReaderSummary, revision: 9 } });
    await read.promise;
  });
  f.show();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
  expect(privateReaderInvalidate).not.toHaveBeenCalled();
});

it("aborts a stale request when a newer owner DTO revision arrives", async () => {
  const save = deferred<PrivateIntakeReviewResult>();
  privateReaderReview.mockReturnValueOnce(save.promise);
  const f = renderPrivateReader();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  const signal = privateReaderReview.mock.calls[0]?.[1];
  f.update({ summary: { ...privateReaderSummary, revision: 8 } });
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    save.resolve({ ok: true, value: { ...privateReaderSummary, revision: 5 } });
    await save.promise;
  });
  expect(privateReaderInvalidate).not.toHaveBeenCalled();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeEnabled();
});

it("keeps a null owner projection entirely quiet", () => {
  renderPrivateReader({ summary: null });
  expect(screen.queryByRole("region")).toBeNull();
  expect(privateReaderRead).not.toHaveBeenCalled();
  expect(privateReaderReview).not.toHaveBeenCalled();
});
