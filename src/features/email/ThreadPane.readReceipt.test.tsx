// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActionResult } from "@/types/actionResult";
import { deferred } from "./deliveryObservationReader.fixtures";
import { emailMessagesForLocale } from "./emailMessages";
import {
  cachedRead,
  changed,
  freshQuery,
  markRead,
  markUnread,
  privateReaderInvalidate,
  type ReadStateData,
  readerState,
  refetch,
  resetReadStateFixture,
  setThreadData,
  readerUi as ui,
  unknownRead,
} from "./ThreadPane.readState.test.fixtures";

beforeEach(resetReadStateFixture);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Observer restored-cache behavior is a contract fixture, not a network cancellation test.
it.each(["fa", "de", "en"] as const)(
  "keeps %s read mutations locked when cached observer success hides an unfinished fresh read",
  async (locale) => {
    markRead.mockResolvedValueOnce(unknownRead());
    render(ui(locale));
    const text = emailMessagesForLocale(locale);
    await screen.findByRole("alert");
    refetch.mockResolvedValueOnce(cachedRead());
    const fresh = deferred<ReadStateData>();
    freshQuery.mockReturnValueOnce(fresh.promise);
    try {
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: text.remoteActions.refresh }));
      expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(freshQuery).toHaveBeenCalledTimes(1);
      expect(setThreadData).not.toHaveBeenCalled();
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      await act(async () => {
        fresh.reject(new Error("private-fresh-request-failed"));
        await Promise.resolve();
      });
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
      expect(screen.queryByText(/private-fresh-request-failed/u)).not.toBeInTheDocument();
      expect(refetch).not.toHaveBeenCalled();
      expect(setThreadData).not.toHaveBeenCalled();
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markUnread).not.toHaveBeenCalled();
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        fresh.resolve(readerState.data);
        await Promise.resolve();
      });
    }
  },
);

const receipts = (["fa", "de", "en"] as const).flatMap((locale) =>
  (["automatic", "manual"] as const).map((direction) => ({ locale, direction })),
);
it.each(receipts)(
  "bounds an unacknowledged $locale $direction read action and ignores its late settlement",
  async ({ locale, direction }) => {
    vi.useFakeTimers();
    const pending = deferred<ActionResult<{ threadId: string }>>();
    const action = direction === "automatic" ? markRead : markUnread;
    action.mockReturnValueOnce(pending.promise);
    const text = emailMessagesForLocale(locale);
    render(ui(locale));
    try {
      await act(async () => {
        await Promise.resolve();
      });
      if (direction === "manual") {
        expect(privateReaderInvalidate).toHaveBeenCalledTimes(2);
        privateReaderInvalidate.mockClear();
        changed.mockClear();
        fireEvent.click(screen.getByRole("button", { name: text.markAsUnread }));
      }
      const unread = screen.getByRole("button", { name: text.markAsUnread });
      expect(unread).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(screen.queryByText(text.errorMarkUnread)).not.toBeInTheDocument();
      expect(unread).toBeDisabled();
      fireEvent.click(unread);
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markUnread).toHaveBeenCalledTimes(direction === "manual" ? 1 : 0);
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      await act(async () => {
        if (direction === "automatic")
          pending.resolve({ ok: true, value: { threadId: readerState.data.thread.id } });
        else pending.reject(new Error("private-late-action-rejection"));
        await Promise.resolve();
      });
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(screen.queryByText(/private-late-action-rejection/u)).not.toBeInTheDocument();
      expect(unread).toBeDisabled();
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markUnread).toHaveBeenCalledTimes(direction === "manual" ? 1 : 0);
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        pending.resolve({ ok: true, value: { threadId: readerState.data.thread.id } });
        await Promise.resolve();
      });
    }
  },
);
