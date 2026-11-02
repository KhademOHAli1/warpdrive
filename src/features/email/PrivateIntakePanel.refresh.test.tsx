// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { err, ok } from "@/types/result";
import type { PrivateIntakePanelProps } from "./PrivateIntakePanel";
import { deferred, intakeSummary, renderPrivateIntake } from "./PrivateIntakePanel.test-support";
import type { PrivateIntakeReviewResult } from "./privateIntakeTypes";

afterEach(cleanup);

it("does not roll a saved revision back when stale parent data arrives", async () => {
  const f = renderPrivateIntake();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await waitFor(() => expect(f.onReviewed).toHaveBeenCalledTimes(1), { timeout: 1000 });
  f.update({ summary: { ...intakeSummary } });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Hide from review list" }));
  expect(f.onReview).toHaveBeenLastCalledWith(
    {
      intakeId: intakeSummary.id,
      expectedRevision: 5,
      decision: "dismiss",
    },
    expect.any(AbortSignal),
  );
});

it.each(["identity", "owner_loss", "unmount"] as const)(
  "aborts a pending fresh read on %s and ignores its late result",
  async (change) => {
    const pending = deferred<PrivateIntakeReviewResult>();
    const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() =>
      Promise.resolve(err("conflict")),
    );
    const onRefresh = vi.fn<NonNullable<PrivateIntakePanelProps["onRefresh"]>>(
      () => pending.promise,
    );
    const f = renderPrivateIntake({ onReview, onRefresh });
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    await f.user.click(screen.getByRole("button", { name: "Keep private" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 1000 });
    await f.user.click(screen.getByRole("button", { name: "Refresh review" }));
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing review");
    const signal = onRefresh.mock.calls[0]?.[0];
    if (change === "identity")
      f.update({
        summary: {
          ...intakeSummary,
          id: "22222222-2222-4222-8222-222222222222",
          revision: 0,
        },
      });
    if (change === "owner_loss") f.update({ isOwner: false });
    if (change === "unmount") f.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      pending.resolve(ok({ ...intakeSummary, revision: 9 }));
      await pending.promise;
    });
    expect(f.onReviewed).not.toHaveBeenCalled();
    expect(screen.queryByText("Review saved")).toBeNull();
  },
);

it("keeps a failed fresh read locked without publishing canonical data", async () => {
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() =>
    Promise.resolve(err("conflict")),
  );
  const onRefresh = vi.fn<NonNullable<PrivateIntakePanelProps["onRefresh"]>>(() =>
    Promise.resolve(err("forbidden")),
  );
  const f = renderPrivateIntake({ onReview, onRefresh });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument(), { timeout: 1000 });
  await f.user.click(screen.getByRole("button", { name: "Refresh review" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("permission"), {
    timeout: 1000,
  });
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
  expect(f.onReviewed).not.toHaveBeenCalled();
});

it.each(["unverified", "conflict", "confirmed_notification"] as const)(
  "keeps %s review separate from sending and does not promise restored purged content",
  async (state) => {
    const f = renderPrivateIntake({
      summary: {
        ...intakeSummary,
        state,
        contentState: "purged",
        decision: "dismiss",
      },
    });
    expect(screen.getByText(/stored content has been removed/)).toBeInTheDocument();
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    expect(screen.getByRole("button", { name: "Return to review list" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /send|reply|share|restore content/i })).toBeNull();
    const dialog = screen.getByRole("dialog");
    if (state === "confirmed_notification") {
      expect(
        within(dialog).getByText(
          "This copy matches the email service’s send acknowledgement. Your review does not change its send status.",
        ),
      ).toBeVisible();
      expect(
        within(dialog).queryByText(
          /Replies, sharing, archiving and links to CRM records are unavailable/,
        ),
      ).toBeNull();
    } else {
      expect(
        within(dialog).getByText(
          /Replies, sharing, archiving and links to CRM records are unavailable/,
        ),
      ).toBeVisible();
    }
    expect(f.onReview).not.toHaveBeenCalled();
  },
);
