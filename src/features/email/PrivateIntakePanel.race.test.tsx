// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import type { PrivateIntakePanelProps } from "./PrivateIntakePanel";
import { deferred, intakeSummary, renderPrivateIntake } from "./PrivateIntakePanel.test-support";
import type { PrivateIntakeReviewResult } from "./privateIntakeTypes";

afterEach(cleanup);

it.each(["forbidden", "conflict", "not_found", "unavailable"] as const)(
  "keeps %s fixed across close/reopen and same-version props",
  async (failure) => {
    const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() =>
      Promise.resolve(err(failure)),
    );
    const f = renderPrivateIntake({ onReview });
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    await f.user.click(screen.getByRole("button", { name: "Keep private" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 1000 });
    await f.user.click(screen.getByRole("button", { name: "Cancel" }));
    f.update({ summary: { ...intakeSummary } });
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hide from review list" })).toBeDisabled();
    expect(onReview).toHaveBeenCalledTimes(1);
  },
);

it("clears a denial only after an explicit successful fresh read", async () => {
  const onReview = vi
    .fn<PrivateIntakePanelProps["onReview"]>()
    .mockResolvedValueOnce(err("conflict"))
    .mockImplementation((input) =>
      Promise.resolve(
        ok({ ...intakeSummary, revision: input.expectedRevision + 1, decision: input.decision }),
      ),
    );
  const onRefresh = vi.fn<NonNullable<PrivateIntakePanelProps["onRefresh"]>>(() =>
    Promise.resolve(ok({ ...intakeSummary, revision: 7 })),
  );
  const f = renderPrivateIntake({ onReview, onRefresh });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 1000 });
  await f.user.click(screen.getByRole("button", { name: "Refresh review" }));
  await waitFor(() => expect(onRefresh).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal)), {
    timeout: 1000,
  });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Hide from review list" }));
  expect(onReview).toHaveBeenLastCalledWith(
    { intakeId: intakeSummary.id, expectedRevision: 7, decision: "dismiss" },
    expect.any(AbortSignal),
  );
});

it("accepts a newer server revision without allowing an old request to overwrite it", async () => {
  const pending = deferred<PrivateIntakeReviewResult>();
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() => pending.promise);
  const f = renderPrivateIntake({ onReview });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  const signal = onReview.mock.calls[0]?.[1];
  f.update({ summary: { ...intakeSummary, revision: 8 } });
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    pending.resolve(ok({ ...intakeSummary, revision: 5, decision: "keep_private" }));
    await pending.promise;
  });
  expect(f.onReviewed).not.toHaveBeenCalled();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeEnabled();
});

it.each(["unmount", "identity", "owner_loss"] as const)(
  "aborts on %s and ignores a late result",
  async (change) => {
    const pending = deferred<PrivateIntakeReviewResult>();
    const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() => pending.promise);
    const f = renderPrivateIntake({ onReview });
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    await f.user.click(screen.getByRole("button", { name: "Keep private" }));
    const signal = onReview.mock.calls[0]?.[1];
    if (change === "unmount") f.unmount();
    if (change === "identity")
      f.update({
        summary: { ...intakeSummary, id: "22222222-2222-4222-8222-222222222222", revision: 0 },
      });
    if (change === "owner_loss") f.update({ isOwner: false });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(ok({ ...intakeSummary, revision: 5, decision: "keep_private" }));
      await pending.promise;
    });
    expect(f.onReviewed).not.toHaveBeenCalled();
    expect(screen.queryByText("Review saved")).toBeNull();
  },
);

it("aborts a cancelled pending review and requires fresh state before another action", async () => {
  const pending = deferred<PrivateIntakeReviewResult>();
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() => pending.promise);
  const f = renderPrivateIntake({ onReview });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await f.user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onReview.mock.calls[0]?.[1].aborted).toBe(true);
  await act(async () => {
    pending.resolve(ok({ ...intakeSummary, revision: 5, decision: "keep_private" }));
    await pending.promise;
  });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
  expect(f.onReviewed).not.toHaveBeenCalled();
});

it("shows a calm unavailable state for operational throws without exposing diagnostics", async () => {
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() =>
    Promise.reject(new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "postgres://synthetic-secret")),
  );
  const f = renderPrivateIntake({ onReview });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("could not confirm"), {
    timeout: 1000,
  });
  expect(screen.queryByText(/postgres:/)).toBeNull();
});

it.each([false, true])("has no review surface without owner-scoped data (%s)", (isOwner) => {
  renderPrivateIntake({ isOwner, summary: isOwner ? null : intakeSummary });
  expect(screen.queryByRole("region")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});
