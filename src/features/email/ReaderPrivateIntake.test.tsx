// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "./deliveryObservationReader.fixtures";
import { emailMessagesForLocale } from "./emailMessages";
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
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe.each(["fa", "de", "en"] as const)("private native reader workflow in %s", (locale) => {
  const L = emailMessagesForLocale(locale).privateIntake;
  it("preserves the owner projection and keyboard dialog with send controls unavailable", async () => {
    const f = renderPrivateReader({}, locale);
    expect(screen.getByRole("region", { name: L.title })).toHaveAttribute(
      "dir",
      locale === "fa" ? "rtl" : "ltr",
    );
    const trigger = screen.getByRole("button", { name: L.review });
    trigger.focus();
    await f.user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: L.dialogTitle });
    expect(dialog).toHaveAttribute("dir", locale === "fa" ? "rtl" : "ltr");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await f.user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(privateReaderRead).not.toHaveBeenCalled();
    expect(privateReaderReview).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /reply|send|share|پاسخ|ارسال|senden|antworten/iu }),
    ).toBeNull();
  });

  it("submits dismiss then restore using the latest private revision", async () => {
    const f = renderPrivateReader({}, locale);
    await f.user.click(screen.getByRole("button", { name: L.review }));
    await f.user.click(screen.getByRole("button", { name: L.dismiss }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(L.saved));
    expect(privateReaderReview).toHaveBeenLastCalledWith(
      {
        accountId: privateReaderIds.account,
        intakeId: privateReaderIds.intake,
        expectedRevision: 4,
        decision: "dismiss",
      },
      expect.any(AbortSignal),
    );
    f.update({ summary: { ...privateReaderSummary } });
    await f.user.click(screen.getByRole("button", { name: L.review }));
    await f.user.click(screen.getByRole("button", { name: L.restore }));
    expect(privateReaderReview).toHaveBeenLastCalledWith(
      {
        accountId: privateReaderIds.account,
        intakeId: privateReaderIds.intake,
        expectedRevision: 5,
        decision: "restore_private",
      },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(privateReaderInvalidate).toHaveBeenCalled());
  });
});

it("defers all reader/DTO invalidation until the panel consumes the resolved native result", async () => {
  const save = deferred<PrivateIntakeReviewResult>();
  privateReaderReview.mockReturnValueOnce(save.promise);
  renderPrivateReader();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Review copy" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep private" }));
  expect(privateReaderInvalidate).not.toHaveBeenCalled();
  await act(async () => {
    save.resolve({
      ok: true,
      value: { ...privateReaderSummary, revision: 5, decision: "keep_private" },
    });
    await save.promise;
  });
  expect(screen.getByRole("status")).toHaveTextContent("Review saved");
  expect(privateReaderInvalidate).not.toHaveBeenCalled();
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
  expect(privateReaderInvalidate).toHaveBeenCalledTimes(9);
});

it.each(["forbidden", "conflict"] as const)(
  "keeps fixed %s across dialog close, hidden collapse and same-version props",
  async (error) => {
    privateReaderReview.mockResolvedValue({ ok: false, error });
    const f = renderPrivateReader();
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    await f.user.click(screen.getByRole("button", { name: "Keep private" }));
    await screen.findByRole("alert");
    await f.user.click(screen.getByRole("button", { name: "Cancel" }));
    f.hide();
    f.update({ summary: { ...privateReaderSummary } });
    f.show();
    await f.user.click(screen.getByRole("button", { name: "Review copy" }));
    expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
    expect(privateReaderReview).toHaveBeenCalledTimes(1);
    expect(privateReaderRead).not.toHaveBeenCalled();
  },
);

it("clears a fixed error only through an authenticated fresh read of the exact account and intake", async () => {
  privateReaderReview.mockResolvedValueOnce({ ok: false, error: "conflict" });
  const f = renderPrivateReader();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await screen.findByRole("alert");
  await f.user.click(screen.getByRole("button", { name: "Refresh review" }));
  expect(privateReaderRead).toHaveBeenCalledExactlyOnceWith(
    { accountId: privateReaderIds.account, intakeId: privateReaderIds.intake },
    expect.any(AbortSignal),
  );
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  expect(screen.getByRole("button", { name: "Keep private" })).toBeEnabled();
});

it("rejects a regressing fresh read instead of restoring an older revision", async () => {
  privateReaderReview
    .mockResolvedValueOnce({
      ok: true,
      value: { ...privateReaderSummary, revision: 5, decision: "keep_private" },
    })
    .mockResolvedValueOnce({ ok: false, error: "conflict" });
  const f = renderPrivateReader();
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Keep private" }));
  await screen.findByRole("status");
  await f.user.click(screen.getByRole("button", { name: "Review copy" }));
  await f.user.click(screen.getByRole("button", { name: "Hide from review list" }));
  await screen.findByRole("alert");
  privateReaderRead.mockResolvedValueOnce({ ok: true, value: privateReaderSummary });
  await f.user.click(screen.getByRole("button", { name: "Refresh review" }));
  expect(screen.getByRole("alert")).toHaveTextContent("changed elsewhere");
  expect(screen.getByRole("button", { name: "Keep private" })).toBeDisabled();
});

it("never renders provider exceptions in the localized private review surface", async () => {
  privateReaderReview.mockRejectedValueOnce(
    new DOMException("private-provider-secret", "NetworkError"),
  );
  const f = renderPrivateReader({}, "de");
  const L = emailMessagesForLocale("de").privateIntake;
  await f.user.click(screen.getByRole("button", { name: L.review }));
  await f.user.click(screen.getByRole("button", { name: L.keepPrivate }));
  expect(await screen.findByRole("alert")).toHaveTextContent(L.errors.unavailable);
  expect(f.container).not.toHaveTextContent("private-provider-secret");
});
