// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActionResult } from "@/types/actionResult";
import { deferred } from "./deliveryObservationReader.fixtures";
import { emailMessagesForLocale } from "./emailMessages";
import {
  changed,
  close,
  freshQuery,
  markRead,
  markUnread,
  privateReaderInvalidate,
  readerState,
  readIntentReceipt,
  reconcileRead,
  resetReadStateFixture,
  readerUi as ui,
  unknownRead,
} from "./ThreadPane.readState.test.fixtures";

beforeEach(resetReadStateFixture);
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

const cases = [
  { locale: "fa", direction: "automatic", refresh: "thread-dto" },
  { locale: "de", direction: "manual", refresh: "thread-dto" },
  { locale: "en", direction: "manual", refresh: "rejected-read" },
] as const;

// A matching current observation does not contain a receipt for the old write.
it.each(cases)(
  "keeps a timed-out $locale $direction write unproven after a $refresh recovery response",
  async ({ locale, direction, refresh }) => {
    vi.useFakeTimers();
    const original = deferred<ActionResult<{ threadId: string }>>();
    const action = direction === "automatic" ? markRead : markUnread;
    action.mockReturnValueOnce(original.promise);
    const view = render(ui(locale));
    const text = emailMessagesForLocale(locale);
    try {
      await act(async () => {
        await Promise.resolve();
      });
      const body = screen.getByTestId("reader-body");
      const draft = screen.getByRole("textbox", { name: "Draft preservation probe" });
      fireEvent.change(draft, { target: { value: "keep this draft" } });
      const unread = screen.getByRole("button", { name: text.markAsUnread });
      if (direction === "manual") {
        expect(privateReaderInvalidate).toHaveBeenCalledTimes(2);
        expect(changed).toHaveBeenCalledTimes(1);
        privateReaderInvalidate.mockClear();
        changed.mockClear();
        fireEvent.click(unread);
      }
      expect(unread).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();

      reconcileRead.mockResolvedValueOnce({ ok: true, value: readIntentReceipt("unknown") });
      if (refresh === "rejected-read") {
        freshQuery.mockRejectedValueOnce(new Error("private-outcome-read-response"));
      } else {
        // Even a current read marker does not settle an unanswered operation.
        freshQuery.mockResolvedValueOnce({
          ...readerState.data,
          thread: { ...readerState.data.thread, unread: false },
        });
      }
      fireEvent.click(screen.getByRole("button", { name: text.remoteActions.refresh }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(freshQuery).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("reader-body")).toBe(body);
      expect(screen.getByRole("textbox", { name: "Draft preservation probe" })).toBe(draft);
      expect(draft).toHaveValue("keep this draft");
      expect(close).not.toHaveBeenCalled();
      expect(screen.queryByText(/private-outcome-read-response/u)).not.toBeInTheDocument();
      expect(screen.queryByText(text.errorMarkUnread)).not.toBeInTheDocument();
      expect(unread).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      fireEvent.click(unread);
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markUnread).toHaveBeenCalledTimes(direction === "manual" ? 1 : 0);

      await act(async () => {
        original.resolve(unknownRead());
        await original.promise;
      });
      expect(unread).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markUnread).toHaveBeenCalledTimes(direction === "manual" ? 1 : 0);
    } finally {
      view.unmount();
      await act(async () => {
        original.resolve(unknownRead());
        await original.promise;
      });
    }
  },
);
