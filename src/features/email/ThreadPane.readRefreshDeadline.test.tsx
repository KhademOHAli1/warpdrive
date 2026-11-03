// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deferred } from "./deliveryObservationReader.fixtures";
import { emailMessagesForLocale } from "./emailMessages";
import {
  changed,
  freshQuery,
  markRead,
  markUnread,
  privateReaderInvalidate,
  type ReadStateData,
  readerState,
  resetReadStateFixture,
  setThreadData,
  readerUi as ui,
  unknownRead,
} from "./ThreadPane.readState.test.fixtures";

beforeEach(resetReadStateFixture);
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(["fa", "de", "en"] as const)(
  "bounds a stalled %s recovery read, aborts it, and ignores its receipt during a newer refresh",
  async (locale) => {
    vi.useFakeTimers();
    markRead.mockResolvedValueOnce(unknownRead());
    const old = deferred<ReadStateData>();
    const next = deferred<ReadStateData>();
    freshQuery.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    const view = render(ui(locale));
    const text = emailMessagesForLocale(locale);
    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      const refresh = screen.getByRole("button", { name: text.remoteActions.refresh });
      const unread = screen.getByRole("button", { name: text.markAsUnread });
      fireEvent.click(refresh);
      await act(async () => {
        await Promise.resolve();
      });
      const oldSignal = freshQuery.mock.calls[0]?.[1]?.signal;
      expect(oldSignal).toBeInstanceOf(AbortSignal);
      expect(oldSignal.aborted).toBe(false);
      expect(refresh).toBeDisabled();
      expect(unread).toBeDisabled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(oldSignal.aborted).toBe(true);
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(refresh).toBeEnabled();
      expect(unread).toBeDisabled();
      fireEvent.click(unread);
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markUnread).not.toHaveBeenCalled();
      expect(setThreadData).not.toHaveBeenCalled();
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();

      fireEvent.click(refresh);
      await act(async () => {
        await Promise.resolve();
      });
      expect(freshQuery).toHaveBeenCalledTimes(2);
      expect(refresh).toBeDisabled();
      const nextSignal = freshQuery.mock.calls[1]?.[1]?.signal;
      expect(nextSignal).toBeInstanceOf(AbortSignal);
      expect(nextSignal).not.toBe(oldSignal);
      expect(nextSignal.aborted).toBe(false);
      await act(async () => {
        old.resolve({ ...readerState.data, thread: { ...readerState.data.thread, unread: true } });
        await old.promise;
      });
      expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
      expect(refresh).toBeDisabled();
      expect(unread).toBeDisabled();
      expect(setThreadData).not.toHaveBeenCalled();
      expect(privateReaderInvalidate).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();

      const freshData = { ...readerState.data, thread: { ...readerState.data.thread } };
      await act(async () => {
        next.resolve(freshData);
        await next.promise;
      });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(unread).toBeEnabled();
      expect(setThreadData).toHaveBeenCalledTimes(1);
      expect(setThreadData.mock.calls[0]?.[1]).toBe(freshData);
      expect(privateReaderInvalidate).toHaveBeenCalledTimes(2);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markUnread).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      await act(async () => {
        old.resolve(readerState.data);
        next.resolve(readerState.data);
        await Promise.resolve();
      });
    }
  },
);
