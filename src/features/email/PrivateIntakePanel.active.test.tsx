// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { err, ok } from "@/types/result";
import type { PrivateIntakePanelProps } from "./PrivateIntakePanel";
import { deferred, intakeSummary, renderPrivateIntake } from "./PrivateIntakePanel.test-support";
import type { PrivateIntakeReviewResult } from "./privateIntakeTypes";

beforeEach(() => configure({ asyncUtilTimeout: 500 }));
afterEach(cleanup);

it("disables a mounted inactive review and never opens its portaled dialog", async () => {
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>();
  const f = renderPrivateIntake({ active: false, onReview });
  const trigger = screen.getByRole("button", { name: "Review copy" });
  expect(trigger).toBeDisabled();
  await f.user.click(trigger);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(onReview).not.toHaveBeenCalled();
});

it("closes an inactive dialog without discarding an untouched review", async () => {
  const f = renderPrivateIntake();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  f.update({ active: false });
  expect(screen.queryByRole("dialog")).toBeNull();
  f.update({ active: true });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeEnabled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("aborts a hidden pending mutation and keeps the uncertain-result lock across reopen", async () => {
  const pending = deferred<PrivateIntakeReviewResult>();
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() => pending.promise);
  const f = renderPrivateIntake({ onReview });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  const signal = onReview.mock.calls[0]?.[1];
  f.update({ active: false });
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => {
    pending.resolve(ok({ ...intakeSummary, revision: 5, decision: "keep_private" }));
    await pending.promise;
  });
  f.update({ active: true, summary: { ...intakeSummary } });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("could not confirm");
  expect(f.onReviewed).not.toHaveBeenCalled();
  expect(onReview).toHaveBeenCalledTimes(1);
});

it.each(["forbidden", "conflict"] as const)(
  "preserves fixed %s lockout across inactive/active and same-version props",
  async (error) => {
    const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() => Promise.resolve(err(error)));
    const f = renderPrivateIntake({ onReview });
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    await f.user.click(screen.getByRole("button", { name: "Keep private" }));
    await screen.findByRole("alert");
    f.update({ active: false });
    expect(screen.queryByRole("dialog")).toBeNull();
    f.update({ active: true, summary: { ...intakeSummary } });
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
    expect(onReview).toHaveBeenCalledTimes(1);
  },
);

it("aborts a hidden fresh read and retains its lock until an active authenticated refresh", async () => {
  const pending = deferred<PrivateIntakeReviewResult>();
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() =>
    Promise.resolve(err("conflict")),
  );
  const onRefresh = vi.fn<NonNullable<PrivateIntakePanelProps["onRefresh"]>>(() => pending.promise);
  const f = renderPrivateIntake({ onReview, onRefresh });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await screen.findByRole("alert");
  await f.user.click(screen.getByRole("button", { name: "Refresh review" }));
  const signal = onRefresh.mock.calls[0]?.[0];
  f.update({ active: false });
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve(ok({ ...intakeSummary, revision: 9 }));
    await pending.promise;
  });
  f.update({ active: true });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
  expect(f.onReviewed).not.toHaveBeenCalled();
});

it("accepts an actual newer canonical revision after hidden cancellation", async () => {
  const pending = deferred<PrivateIntakeReviewResult>();
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() => pending.promise);
  const f = renderPrivateIntake({ onReview });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  f.update({ active: false });
  f.update({ active: true, summary: { ...intakeSummary, revision: 8 } });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeEnabled();
  await act(async () => {
    pending.resolve(ok({ ...intakeSummary, revision: 5 }));
    await pending.promise;
  });
  await waitFor(() => expect(f.onReviewed).not.toHaveBeenCalled());
});
