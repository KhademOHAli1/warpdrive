// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMailboxRefresh } from "./useMailboxRefresh";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

it("refreshes visible idle settings without overlapping or flickering, aborts hidden/unmounted requests", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const signals: AbortSignal[] = [];
  let resolve: ((value: { ok: true; value: never[] }) => void) | undefined;
  const load = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<{ ok: true; value: never[] }>((done) => {
      resolve = done;
    });
  });
  const accept = vi.fn();
  const { result, unmount } = renderHook(() => useMailboxRefresh(load, accept));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(load).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20_000);
  });
  expect(load).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue("hidden");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(signals[0]?.aborted).toBe(true);
  await act(async () => {
    resolve?.({ ok: true, value: [] });
    await Promise.resolve();
  });
  expect(accept).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(load).toHaveBeenCalledTimes(2);
  unmount();
  expect(signals[1]?.aborted).toBe(true);
});

it("pauses around open mailbox dialogs and lets explicit refresh supersede stale background results", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  const pending: {
    signal: AbortSignal;
    resolve: (value: { ok: true; value: number[] }) => void;
  }[] = [];
  const load = vi.fn(
    (signal: AbortSignal) =>
      new Promise<{ ok: true; value: number[] }>((resolve) => pending.push({ signal, resolve })),
  );
  const accept = vi.fn();
  const { result } = renderHook(() => useMailboxRefresh(load, accept));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(load).not.toHaveBeenCalled();
  dialog.remove();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(load).toHaveBeenCalledTimes(1);
  act(() => result.current.reload());
  expect(pending[0]?.signal.aborted).toBe(true);
  expect(result.current.busy).toBe(true);
  await act(async () => {
    pending[1]?.resolve({ ok: true, value: [2] });
    pending[0]?.resolve({ ok: true, value: [1] });
    await Promise.resolve();
  });
  expect(accept).toHaveBeenCalledExactlyOnceWith([2]);
  expect(result.current.busy).toBe(false);
});
