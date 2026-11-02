// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import type { InlineSaveResult } from "@/features/inline-edit/useInlineEditField";
import { useDealEditSnapshot } from "./useDealEditSnapshot";

const FIRST = "00000000-0000-4000-8000-000000000001";
const SECOND = "00000000-0000-4000-8000-000000000002";

afterEach(cleanup);

describe("deal edit snapshot binding", () => {
  it("binds an initially open new field to its mounted snapshot across a props refresh", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, error: ERROR_IDS.DEAL_PRECONDITION });
    const { result, rerender } = renderHook(
      ({ value, version }) => useDealEditSnapshot(value, version, true),
      { initialProps: { value: "", version: FIRST } },
    );
    expect(result.current.editing).toBe(true);
    act(() => result.current.setDraft("My new field value"));
    rerender({ value: "Another actor's value", version: SECOND });
    act(() => result.current.commit(save));
    await waitFor(() => expect(result.current.error).toBe(ERROR_IDS.DEAL_PRECONDITION));
    expect(save).toHaveBeenCalledWith("My new field value", FIRST);
    expect(result.current.draft).toBe("My new field value");
  });

  it("keeps an initially open legacy field blocked when refreshed props gain a version", () => {
    const save = vi.fn();
    const { result, rerender } = renderHook(
      ({ value, version }) => useDealEditSnapshot(value, version, true),
      { initialProps: { value: "", version: undefined as unknown as string } },
    );
    act(() => result.current.setDraft("Retained new field value"));
    rerender({ value: "Refreshed value", version: SECOND });
    act(() => result.current.commit(save));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.error).toBe(ERROR_IDS.DEAL_PRECONDITION);
    act(() => {
      result.current.start();
    });
    act(() => result.current.commit(save));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.draft).toBe("Retained new field value");
  });

  it("does not restart a pending edit onto refreshed props before its rejection", async () => {
    let settle!: (result: InlineSaveResult) => void;
    const saving = new Promise<InlineSaveResult>((resolve) => {
      settle = resolve;
    });
    const save = vi.fn(() => saving);
    const { result, rerender } = renderHook(
      ({ value, version }) => useDealEditSnapshot(value, version),
      { initialProps: { value: "Original title", version: FIRST } },
    );
    act(() => {
      result.current.start();
    });
    act(() => result.current.setDraft("Pending attempted title"));
    act(() => result.current.commit(save));
    rerender({ value: "Remotely refreshed title", version: SECOND });
    act(() => {
      result.current.start();
    });
    expect(result.current.editing).toBe(false);
    expect(result.current.draft).toBe("Pending attempted title");
    act(() => settle({ ok: false, error: ERROR_IDS.DEAL_PRECONDITION }));
    await waitFor(() => expect(result.current.pending).toBe(false));
    act(() => {
      result.current.start();
    });
    expect(result.current.draft).toBe("Pending attempted title");
    act(() => result.current.commit(save));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith("Pending attempted title", FIRST);
  });

  it("retains the attempted draft and original token across refresh and conflict retry", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, error: ERROR_IDS.DEAL_PRECONDITION });
    const { result, rerender } = renderHook(
      ({ value, version }) => useDealEditSnapshot(value, version),
      { initialProps: { value: "Original title", version: FIRST } },
    );
    act(() => {
      result.current.start();
    });
    act(() => result.current.setDraft("My attempted title"));
    rerender({ value: "Another actor's title", version: SECOND });
    act(() => result.current.commit(save));
    await waitFor(() => expect(result.current.error).toBe(ERROR_IDS.DEAL_PRECONDITION));
    expect(save).toHaveBeenLastCalledWith("My attempted title", FIRST);
    expect(result.current.draft).toBe("My attempted title");

    act(() => {
      result.current.start();
    });
    expect(result.current.draft).toBe("My attempted title");
    act(() => result.current.commit(save));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith("My attempted title", FIRST);
  });

  it("takes a new snapshot only after explicit cancellation and a new edit", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, value: undefined });
    const { result, rerender } = renderHook(
      ({ value, version }) => useDealEditSnapshot(value, version),
      { initialProps: { value: "Original title", version: FIRST } },
    );
    act(() => {
      result.current.start();
    });
    act(() => result.current.setDraft("Abandoned title"));
    rerender({ value: "Current server title", version: SECOND });
    act(() => {
      result.current.cancel();
    });
    act(() => {
      result.current.start();
    });
    expect(result.current.draft).toBe("Current server title");
    // A submitted logical noop still validates the token instead of claiming a local success.
    act(() => result.current.commit(save));
    await waitFor(() => expect(save).toHaveBeenCalledWith("Current server title", SECOND));
  });

  it("fails a legacy missing-token draft closed without attaching a refreshed token", () => {
    const save = vi.fn();
    const { result, rerender } = renderHook(
      ({ value, version }) => useDealEditSnapshot(value, version),
      { initialProps: { value: "Legacy snapshot", version: undefined as unknown as string } },
    );
    act(() => {
      result.current.start();
    });
    act(() => result.current.setDraft("Retained legacy draft"));
    act(() => result.current.commit(save));
    expect(result.current.error).toBe(ERROR_IDS.DEAL_PRECONDITION);
    rerender({ value: "Refreshed server value", version: SECOND });
    act(() => {
      result.current.start();
    });
    act(() => result.current.commit(save));
    expect(save).not.toHaveBeenCalled();
    expect(result.current.draft).toBe("Retained legacy draft");
    expect(result.current.error).toBe(ERROR_IDS.DEAL_PRECONDITION);
  });
});
