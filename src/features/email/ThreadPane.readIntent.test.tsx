// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActionResult } from "@/types/actionResult";
import { deferred } from "./deliveryObservationReader.fixtures";
import { emailMessagesForLocale } from "./emailMessages";
import type { ReadIntentPreparation, ReadIntentReceipt } from "./readIntentTypes";
import {
  changed,
  freshQuery,
  markRead,
  markUnread,
  preparedReadIntent,
  prepareRead,
  privateReaderIds,
  privateReaderInvalidate,
  readerData,
  readerState,
  readIntentReceipt,
  reconcileRead,
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
  "never executes a late %s preparation after its UI deadline",
  async (locale) => {
    vi.useFakeTimers();
    const preparation = deferred<ActionResult<ReadIntentPreparation>>();
    prepareRead.mockReturnValueOnce(preparation.promise);
    render(ui(locale));
    const text = emailMessagesForLocale(locale);
    await act(async () => {
      await Promise.resolve();
    });
    expect(prepareRead).toHaveBeenCalledTimes(1);
    expect(markRead).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.readStatusFailed);
    expect(screen.getByRole("button", { name: text.markAsUnread })).toBeEnabled();
    await act(async () => {
      preparation.resolve({
        ok: true,
        value: { kind: "created", readIntent: preparedReadIntent() },
      });
      await preparation.promise;
    });
    expect(markRead).not.toHaveBeenCalled();
    expect(markUnread).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
  },
);

it("does not execute a preparation that arrives after its reader frame changes", async () => {
  const preparation = deferred<ActionResult<ReadIntentPreparation>>();
  prepareRead.mockReturnValueOnce(preparation.promise);
  const view = render(ui("en"));
  await act(async () => {
    await Promise.resolve();
  });
  const original = preparedReadIntent();
  readerState.data = readerData(privateReaderIds.otherAccount);
  view.rerender(ui("en"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(markRead).toHaveBeenCalledTimes(1);
  const calls = markRead.mock.calls.length;
  await act(async () => {
    preparation.resolve({ ok: true, value: { kind: "created", readIntent: original } });
    await preparation.promise;
  });
  expect(markRead).toHaveBeenCalledTimes(calls);
  expect(markRead.mock.calls[0]?.[1]?.threadId).toBe(privateReaderIds.otherAccount);
});

it.each(["prepared", "admitted", "unknown"] as const)(
  "does not adopt an older blocked %s command",
  async (state) => {
    const blocked = readIntentReceipt(state, { desiredRead: false });
    prepareRead.mockResolvedValueOnce({
      ok: true,
      value: { kind: "blocked", readIntent: blocked },
    });
    render(ui("de"));
    await act(async () => {
      await Promise.resolve();
    });
    const text = emailMessagesForLocale("de");
    expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
    expect(markRead).not.toHaveBeenCalled();
    expect(markUnread).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
  },
);

it.each(["cancelled", "denied"] as const)(
  "releases a %s intent after a fresh observation without confirming it was applied",
  async (state) => {
    markRead.mockResolvedValueOnce(unknownRead());
    render(ui("fa"));
    await act(async () => {
      await Promise.resolve();
    });
    reconcileRead.mockResolvedValueOnce({ ok: true, value: readIntentReceipt(state) });
    const text = emailMessagesForLocale("fa");
    fireEvent.click(screen.getByRole("button", { name: text.remoteActions.refresh }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(freshQuery).toHaveBeenCalledTimes(1);
    expect(setThreadData).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: text.markAsUnread })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.readStatusFailed);
    expect(changed).not.toHaveBeenCalled();
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(markRead).toHaveBeenCalledTimes(1);
  },
);

it("keeps the gate when a terminal receipt belongs to another operation", async () => {
  markRead.mockResolvedValueOnce(unknownRead());
  render(ui("en"));
  await act(async () => {
    await Promise.resolve();
  });
  reconcileRead.mockResolvedValueOnce({
    ok: true,
    value: readIntentReceipt("applied", { operationId: "22222222-2222-4222-8222-222222222222" }),
  });
  const text = emailMessagesForLocale("en");
  fireEvent.click(screen.getByRole("button", { name: text.remoteActions.refresh }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
  expect(setThreadData).not.toHaveBeenCalled();
  expect(markRead).toHaveBeenCalledTimes(1);
});

it.each(["admitted", "unknown"] as const)(
  "keeps a reconciled %s operation locked after a current observation",
  async (state) => {
    markRead.mockResolvedValueOnce(unknownRead());
    render(ui("de"));
    await act(async () => {
      await Promise.resolve();
    });
    reconcileRead.mockResolvedValueOnce({ ok: true, value: readIntentReceipt(state) });
    const text = emailMessagesForLocale("de");
    fireEvent.click(screen.getByRole("button", { name: text.remoteActions.refresh }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(freshQuery).toHaveBeenCalledTimes(1);
    expect(setThreadData).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.refreshBeforeRetry);
    expect(changed).not.toHaveBeenCalled();
    expect(privateReaderInvalidate).not.toHaveBeenCalled();
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markUnread).not.toHaveBeenCalled();
  },
);

it("does not confirm a new command when reconciliation settles an older blocked operation", async () => {
  const blocked = readIntentReceipt("admitted", { desiredRead: false });
  prepareRead.mockResolvedValueOnce({ ok: true, value: { kind: "blocked", readIntent: blocked } });
  render(ui("en"));
  await act(async () => {
    await Promise.resolve();
  });
  reconcileRead.mockResolvedValueOnce({ ok: true, value: { ...blocked, state: "applied" } });
  const text = emailMessagesForLocale("en");
  fireEvent.click(screen.getByRole("button", { name: text.remoteActions.refresh }));
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("button", { name: text.markAsUnread })).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent(text.remoteActions.readStatusFailed);
  expect(markRead).not.toHaveBeenCalled();
  expect(markUnread).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(privateReaderInvalidate).not.toHaveBeenCalled();
});

it("bounds a stalled reconciliation and never starts a GET from its late response", async () => {
  vi.useFakeTimers();
  markRead.mockResolvedValueOnce(unknownRead());
  render(ui("fa"));
  await act(async () => {
    await Promise.resolve();
  });
  const original = deferred<ActionResult<ReadIntentReceipt>>();
  reconcileRead.mockReturnValueOnce(original.promise);
  const receipt = readIntentReceipt("applied");
  const text = emailMessagesForLocale("fa");
  const refresh = screen.getByRole("button", { name: text.remoteActions.refresh });
  fireEvent.click(refresh);
  await act(async () => {
    await Promise.resolve();
  });
  expect(reconcileRead).toHaveBeenCalledTimes(1);
  expect(freshQuery).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(refresh).toBeEnabled();
  expect(screen.getByRole("button", { name: text.markAsUnread })).toBeDisabled();
  await act(async () => {
    original.resolve({ ok: true, value: receipt });
    await original.promise;
  });
  expect(freshQuery).not.toHaveBeenCalled();
  expect(setThreadData).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(refresh);
  await act(async () => {
    await Promise.resolve();
  });
  expect(reconcileRead).toHaveBeenCalledTimes(2);
  expect(freshQuery).toHaveBeenCalledTimes(1);
  expect(setThreadData).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: text.markAsUnread })).toBeEnabled();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(privateReaderInvalidate).toHaveBeenCalledTimes(2);
  expect(markRead).toHaveBeenCalledTimes(1);
  expect(markUnread).not.toHaveBeenCalled();
});
