// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let nextId = 0;
const saveMock = vi.fn(() => Promise.resolve({ ok: true, value: { id: `d${++nextId}` } }));
const deleteMock = vi.fn(() => Promise.resolve({ ok: true, value: { id: "d1" } }));
vi.mock("../folderActions", () => ({
  saveDraftAction: (...a: unknown[]) => saveMock(...(a as [])),
  deleteDraftAction: (...a: unknown[]) => deleteMock(...(a as [])),
}));
// Runtime args are captured by the wrapper above; the mock's own type is arg-less, so read
// the recorded calls through an unknown[][] view to index the input payload.
const saveCalls = (): unknown[][] => saveMock.mock.calls;
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
const captureExceptionMock = vi.fn();
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  captureException: (...a: unknown[]) => captureExceptionMock(...(a as [])),
  currentRoute: () => "/inbox",
}));

import { useDraftAutosave } from "./useDraftAutosave";

const base = () => ({
  accountId: "acc",
  threadId: null as string | null,
  subject: "",
  body: "",
  toList: [] as string[],
  ccList: [] as string[],
  visibility: "shared" as const,
  initialDraftId: undefined as string | undefined,
  draftIdRef: { current: undefined as string | undefined },
  inFlightRef: { current: null as Promise<void> | null },
});

beforeEach(() => {
  vi.useFakeTimers();
  nextId = 0;
  saveMock.mockClear();
  deleteMock.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("workspace draft autosave", () => {
  it("shows an error when saving fails and can retry the same content", async () => {
    saveMock.mockRejectedValueOnce(new Error("offline"));
    const props = { ...base(), subject: "Keep this reply" };
    const { result } = renderHook((p) => useDraftAutosave(p), { initialProps: props });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.status).toBe("error");
    act(() => result.current.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(result.current.status).toBe("saved");
    expect(saveCalls().at(-1)?.[1]).toMatchObject({ subject: "Keep this reply" });
  });

  it("saves the newest edit after an earlier save finishes, using the same draft id", async () => {
    let release!: () => void;
    saveMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, value: { id: "d1" } });
        }),
    );
    const props = { ...base(), subject: "First" };
    const { rerender } = renderHook((p) => useDraftAutosave(p), { initialProps: props });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    rerender({ ...props, subject: "Newest" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveCalls()[1]?.[1]).toMatchObject({ id: "d1", subject: "Newest" });
  });
});
