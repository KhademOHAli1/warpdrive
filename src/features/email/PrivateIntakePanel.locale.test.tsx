// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { err } from "@/types/result";
import type { PrivateIntakePanelProps } from "./PrivateIntakePanel";
import { intakeSummary, renderPrivateIntake } from "./PrivateIntakePanel.test-support";

afterEach(cleanup);

const labels = {
  fa: {
    review: "بررسی نسخه",
    dismiss: "کنار گذاشتن",
    restore: "بازگرداندن به فهرست بررسی",
    saved: "بررسی ثبت شد",
    conflict: "وضعیت بررسی در جای دیگری تغییر کرده است.",
  },
  de: {
    review: "Kopie prüfen",
    dismiss: "Ausblenden",
    restore: "Wieder in der Prüfliste anzeigen",
    saved: "Prüfung gespeichert",
    conflict: "Diese Prüfung wurde an anderer Stelle geändert.",
  },
  en: {
    review: "Review copy",
    dismiss: "Hide from review list",
    restore: "Return to review list",
    saved: "Review saved",
    conflict: "This review changed elsewhere.",
  },
};

it.each(["fa", "de", "en"] as const)(
  "completes dismiss and restore in %s using native revision results",
  async (locale) => {
    const text = labels[locale];
    const f = renderPrivateIntake({}, locale);
    await f.user.click(screen.getByRole("button", { name: text.review }));
    await f.user.click(screen.getByRole("button", { name: text.dismiss }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(text.saved), {
      timeout: 1000,
    });
    expect(f.onReview).toHaveBeenLastCalledWith(
      {
        intakeId: intakeSummary.id,
        expectedRevision: 4,
        decision: "dismiss",
      },
      expect.any(AbortSignal),
    );
    await f.user.click(screen.getByRole("button", { name: text.review }));
    await f.user.click(screen.getByRole("button", { name: text.restore }));
    await waitFor(() => expect(f.onReviewed).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(f.onReview).toHaveBeenLastCalledWith(
      {
        intakeId: intakeSummary.id,
        expectedRevision: 5,
        decision: "restore_private",
      },
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("status")).toHaveTextContent(text.saved);
  },
);

it.each(["fa", "de", "en"] as const)("keeps conflict feedback localized in %s", async (locale) => {
  const text = labels[locale];
  const onReview = vi.fn<PrivateIntakePanelProps["onReview"]>(() =>
    Promise.resolve(err("conflict")),
  );
  const f = renderPrivateIntake({ onReview }, locale);
  await f.user.click(screen.getByRole("button", { name: text.review }));
  await f.user.click(screen.getByRole("button", { name: text.dismiss }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(text.conflict), {
    timeout: 1000,
  });
  expect(screen.getByRole("button", { name: text.dismiss })).toBeDisabled();
  expect(f.onReviewed).not.toHaveBeenCalled();
});
