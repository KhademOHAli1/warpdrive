// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const save = vi.fn<(...args: unknown[]) => Promise<{ ok: true; value: { id: string } }>>();
vi.mock("../folderActions", () => ({
  saveDraftAction: (...args: unknown[]) => save(...args),
  deleteDraftAction: () => Promise.resolve({ ok: true, value: { id: "old" } }),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/observability/capture", () => ({
  captureException: vi.fn(),
  currentRoute: () => "/inbox/compose",
}));

import { useDraftAutosave } from "./useDraftAutosave";

const base = () => ({
  accountId: "old-account",
  threadId: null,
  subject: "پیشنهاد",
  body: "<p>Grüße</p>",
  toList: ["customer@example.com"],
  ccList: [],
  visibility: "private" as const,
  initialDraftId: "old-draft",
  draftIdRef: { current: "old-draft" as string | undefined },
  inFlightRef: { current: null as Promise<void> | null },
});
beforeEach(() => {
  vi.useFakeTimers();
  save.mockReset();
  save.mockResolvedValue({ ok: true, value: { id: "new-draft" } });
});
afterEach(() => vi.useRealTimers());
it("fences an old mailbox response from replacing the copied draft ID or saving it into another mailbox", async () => {
  let finish: ((value: { ok: true; value: { id: string } }) => void) | undefined;
  save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = base();
  const { result, rerender } = renderHook((props) => useDraftAutosave(props), {
    initialProps: first,
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  act(() => result.current.rebind("new-account", "copied-draft"));
  rerender({ ...first, accountId: "new-account", initialDraftId: "copied-draft" });
  await act(async () => {
    finish?.({ ok: true, value: { id: "old-response" } });
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(first.draftIdRef.current).toBe("new-draft");
  expect(save.mock.calls[1]?.[1]).toMatchObject({ id: "copied-draft", accountId: "new-account" });
  expect(
    save.mock.calls.some((call) => {
      const input = call[1] as { id?: string; accountId: string };
      return input.accountId === "new-account" && input.id === "old-response";
    }),
  ).toBe(false);
});
it("cancels an old mailbox debounce before the new draft is bound", async () => {
  const first = base();
  const { result, rerender } = renderHook((props) => useDraftAutosave(props), {
    initialProps: first,
  });
  act(() => result.current.rebind("new-account", "copied-draft"));
  rerender({ ...first, accountId: "new-account", initialDraftId: "copied-draft" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0]?.[1]).toMatchObject({ accountId: "new-account", id: "copied-draft" });
});
it("flushes the current snapshot before copying and persists BCC, attachments, tracking and send intent", async () => {
  const first = {
    ...base(),
    bccList: ["private@example.com"],
    attachments: [{ fileId: "file" }],
    trackOpens: true,
    trackLinks: false,
    sendIntentId: "intent",
  };
  const { result } = renderHook((props) => useDraftAutosave(props), { initialProps: first });
  let saved = false;
  await act(async () => {
    saved = await result.current.flush();
  });
  expect(saved).toBe(true);
  expect(save.mock.calls[0]?.[1]).toMatchObject({
    bccEmails: ["private@example.com"],
    attachments: [{ fileId: "file" }],
    trackOpens: true,
    trackLinks: false,
    sendIntentId: "intent",
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600);
  });
  expect(save).toHaveBeenCalledOnce();
});
