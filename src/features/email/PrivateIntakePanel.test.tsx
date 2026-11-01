// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ok } from "@/types/result";
import type { PrivateIntakePanelProps } from "./PrivateIntakePanel";
import { deferred, intakeSummary, renderPrivateIntake } from "./PrivateIntakePanel.test-support";
import type { PrivateIntakeReviewResult } from "./privateIntakeTypes";

afterEach(cleanup);

it("renders an owner-only private review surface without authorizing ordinary mail actions", () => {
  renderPrivateIntake();
  expect(screen.getByRole("region", { name: "Private email review" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review copy" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /send|reply|share|link/i })).toBeNull();
});

it.each(["fa", "de", "en"] as const)(
  "uses natural %s copy and the existing dialog direction",
  async (locale) => {
    const labels = {
      fa: {
        title: "بررسی خصوصی ایمیل",
        review: "بررسی نسخه",
        keep: "خصوصی نگه‌داشتن",
        dialog: "بررسی نسخهٔ خصوصی",
      },
      de: {
        title: "E-Mail privat prüfen",
        review: "Kopie prüfen",
        keep: "Privat behalten",
        dialog: "Private Kopie prüfen",
      },
      en: {
        title: "Private email review",
        review: "Review copy",
        keep: "Keep private",
        dialog: "Review private copy",
      },
    }[locale];
    const f = renderPrivateIntake({}, locale);
    expect(screen.getByRole("region", { name: labels.title })).toHaveAttribute(
      "dir",
      locale === "fa" ? "rtl" : "ltr",
    );
    await f.user.click(screen.getByRole("button", { name: labels.review }));
    const dialog = screen.getByRole("dialog", { name: labels.dialog });
    expect(dialog).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    expect(within(dialog).getByRole("button", { name: labels.keep })).toBeEnabled();
    expect(f.onReview).not.toHaveBeenCalled();
  },
);

it.each(["keep_private", "dismiss", "restore_private"] as const)(
  "submits the exact current revision and %s decision once",
  async (decision) => {
    const f = renderPrivateIntake({
      summary: { ...intakeSummary, decision: decision === "restore_private" ? "dismiss" : null },
    });
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    const label =
      decision === "keep_private"
        ? "Keep private"
        : decision === "dismiss"
          ? "Hide from review list"
          : "Return to review list";
    await f.user.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(f.onReviewed).toHaveBeenCalledTimes(1), { timeout: 1000 });
    expect(f.onReview).toHaveBeenCalledExactlyOnceWith(
      {
        intakeId: intakeSummary.id,
        expectedRevision: 4,
        decision,
      },
      expect.any(AbortSignal),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Review saved");
  },
);

it("keeps keyboard focus in the dialog and restores the trigger after Escape", async () => {
  const f = renderPrivateIntake();
  const trigger = screen.getByRole("button", { name: "Review copy" });
  trigger.focus();
  await f.user.keyboard("{Enter}");
  const dialog = screen.getByRole("dialog");
  expect(dialog.contains(document.activeElement)).toBe(true);
  await f.user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 1000 });
  expect(trigger).toHaveFocus();
});

it("does not publish canonical state or offer a duplicate action before the native callback returns", async () => {
  const pending = deferred<PrivateIntakeReviewResult>();
  const order: string[] = [];
  const onReviewed = vi.fn(() => {
    order.push("canonical");
  });
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(async () => {
    order.push("callback");
    const result = await pending.promise;
    order.push("returned");
    return result;
  });
  const f = renderPrivateIntake({ onReview, onReviewed });
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  expect(order).toEqual(["callback"]);
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Hide from review list" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Saving review");
  await act(async () => {
    pending.resolve(ok({ ...intakeSummary, revision: 5, decision: "keep_private" }));
    await pending.promise;
  });
  expect(order).toEqual(["callback", "returned", "canonical"]);
});
