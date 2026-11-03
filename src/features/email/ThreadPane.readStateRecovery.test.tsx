// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
import { deferred } from "./deliveryObservationReader.fixtures";
import { emailMessagesForLocale } from "./emailMessages";
import {
  cachedRead,
  changed,
  close,
  freshQuery,
  markRead,
  markUnread,
  privateReaderIds,
  privateReaderInvalidate,
  type ReadStateData,
  readerData,
  readerState,
  refetch,
  resetReadStateFixture,
  setThreadData,
  readerUi as ui,
  unknownRead as unknown,
} from "./ThreadPane.readState.test.fixtures";

beforeEach(resetReadStateFixture);
afterEach(cleanup);

const cases = (["fa", "de", "en"] as const).flatMap((locale) =>
  (["automatic", "manual"] as const).flatMap((direction) =>
    (["rejected", "unconfirmed"] as const).map((outcome) => ({ locale, direction, outcome })),
  ),
);
it.each(cases)(
  "recovers $locale $direction $outcome read-state uncertainty through an exact receipt and observation, never mutation replay",
  async ({ locale, direction, outcome }) => {
    const text = emailMessagesForLocale(locale);
    const action = direction === "automatic" ? markRead : markUnread;
    if (outcome === "rejected")
      action.mockRejectedValueOnce(new DOMException("private-read-response", "NetworkError"));
    else action.mockResolvedValueOnce(unknown());
    const view = render(ui(locale));
    const user = userEvent.setup();
    const body = screen.getByTestId("reader-body");
    const draft = screen.getByRole("textbox", { name: "Draft preservation probe" });
    await user.type(draft, "keep this draft");
    if (direction === "manual") {
      await waitFor(() => expect(privateReaderInvalidate).toHaveBeenCalledTimes(2));
      privateReaderInvalidate.mockClear();
      changed.mockClear();
      await user.click(screen.getByRole("button", { name: text.markAsUnread }));
    }
    expect(await screen.findByRole("alert")).toHaveTextContent(
      text.remoteActions.refreshBeforeRetry,
    );
    expect(screen.queryByText(text.errorMarkUnread)).not.toBeInTheDocument();
    expect(screen.queryByText(/private-read-response/u)).not.toBeInTheDocument();
    const unread = screen.getByRole("button", { name: text.markAsUnread });
    expect(unread).toBeDisabled();
    await user.click(unread);
    view.rerender(ui(locale));
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markUnread).toHaveBeenCalledTimes(direction === "manual" ? 1 : 0);
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();

    const failed = deferred<ReadStateData>();
    freshQuery.mockReturnValueOnce(failed.promise);
    refetch.mockResolvedValueOnce({
      ...cachedRead(),
      error: new Error("private-refresh-response"),
      isError: true,
      isSuccess: false,
      status: "error",
    });
    await user.click(screen.getByRole("button", { name: text.remoteActions.refresh }));
    expect(unread).toBeDisabled();
    expect(freshQuery).toHaveBeenCalledTimes(1);
    await act(async () => {
      failed.reject(new Error("private-refresh-response"));
      await Promise.resolve();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
    expect(screen.queryByText(/private-refresh-response/u)).not.toBeInTheDocument();
    expect(unread).toBeDisabled();
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();

    const fresh = deferred<ReadStateData>();
    freshQuery.mockReturnValueOnce(fresh.promise);
    await user.click(screen.getByRole("button", { name: text.remoteActions.refresh }));
    expect(unread).toBeDisabled();
    const freshData = { ...readerState.data, thread: { ...readerState.data.thread } };
    await act(async () => {
      fresh.resolve(freshData);
      await fresh.promise;
    });
    await waitFor(() => expect(unread).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("reader-body")).toBe(body);
    expect(screen.getByRole("textbox", { name: "Draft preservation probe" })).toBe(draft);
    expect(draft).toHaveValue("keep this draft");
    expect(close).not.toHaveBeenCalled();
    expect(freshQuery).toHaveBeenCalledTimes(2);
    expect(freshQuery).toHaveBeenLastCalledWith(
      { threadId: readerState.data.thread.id, allowRemote: false },
      { signal: expect.any(AbortSignal) },
    );
    expect(refetch).not.toHaveBeenCalled();
    expect(setThreadData).toHaveBeenCalledTimes(1);
    expect(setThreadData.mock.calls[0]?.slice(0, 2)).toEqual([
      { threadId: readerState.data.thread.id, allowRemote: false },
      freshData,
    ]);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markUnread).toHaveBeenCalledTimes(direction === "manual" ? 1 : 0);
  },
);

it.each(["fa", "de", "en"] as const)(
  "ignores an old thread's late mark-read success in %s",
  async (locale) => {
    const old = deferred<unknown>();
    markRead.mockReturnValueOnce(old.promise).mockResolvedValueOnce(unknown());
    const view = render(ui(locale));
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    readerState.data = readerData(privateReaderIds.otherAccount);
    view.rerender(ui(locale));
    const text = emailMessagesForLocale(locale);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      text.remoteActions.refreshBeforeRetry,
    );
    await act(async () => {
      old.resolve({ ok: true, value: { threadId: privateReaderIds.thread } });
      await old.promise;
    });
    expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
    expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(markRead).toHaveBeenCalledTimes(2);
  },
);

it.each(["fa", "de", "en"] as const)(
  "ignores an old thread's late refresh in %s",
  async (locale) => {
    markRead.mockResolvedValue(unknown());
    const view = render(ui(locale));
    const text = emailMessagesForLocale(locale);
    await screen.findByRole("alert");
    const oldData = readerState.data;
    const old = deferred<ReadStateData>();
    freshQuery.mockReturnValueOnce(old.promise);
    await userEvent.setup().click(screen.getByRole("button", { name: text.remoteActions.refresh }));
    expect(freshQuery).toHaveBeenCalledTimes(1);
    const oldSignal = freshQuery.mock.calls[0]?.[1]?.signal;
    expect(oldSignal).toBeInstanceOf(AbortSignal);
    expect(oldSignal.aborted).toBe(false);
    readerState.data = readerData(privateReaderIds.otherAccount);
    view.rerender(ui(locale));
    expect(oldSignal.aborted).toBe(true);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      text.remoteActions.refreshBeforeRetry,
    );
    await act(async () => {
      old.resolve(oldData);
      await old.promise;
    });
    expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
    expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(setThreadData).not.toHaveBeenCalled();
    expect(markRead).toHaveBeenCalledTimes(2);
    expect(markUnread).not.toHaveBeenCalled();

    const detached = deferred<ReadStateData>();
    freshQuery.mockReturnValueOnce(detached.promise);
    await userEvent.setup().click(screen.getByRole("button", { name: text.remoteActions.refresh }));
    const detachedSignal = freshQuery.mock.calls[1]?.[1]?.signal;
    expect(detachedSignal).toBeInstanceOf(AbortSignal);
    expect(detachedSignal.aborted).toBe(false);
    view.unmount();
    expect(detachedSignal.aborted).toBe(true);
    await act(async () => {
      detached.resolve(readerState.data);
      await detached.promise;
    });
    expect(setThreadData).not.toHaveBeenCalled();
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  },
);
