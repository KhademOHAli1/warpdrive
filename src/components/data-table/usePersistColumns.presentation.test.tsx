// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnViewName } from "@/features/identity/preferencesSchema";

const persist = vi.hoisted(() =>
  vi.fn<(input: unknown, csrf: string) => Promise<{ ok: true }>>(() =>
    Promise.resolve({ ok: true }),
  ),
);
vi.mock("@/features/identity/preferencesActions", () => ({ setColumnViewAction: persist }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { usePersistColumns } from "./usePersistColumns";

// A two-argument implementation remains callable here, so RED exercises ignored gating
// rather than relying on a missing export or a TypeScript argument-count failure.
const usePersistWithOptions: (
  view: ColumnViewName,
  order: readonly string[],
  options?: { enabled?: boolean },
) => void = usePersistColumns;

function Harness({ order, enabled }: { order: readonly string[]; enabled?: boolean }) {
  usePersistWithOptions("dealsList", order, { enabled });
  return null;
}
const BASELINE = ["title", "org"];
const VIEW = ["title", "value"];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  persist.mockClear();
});

describe("usePersistColumns saved-view gate", () => {
  it("cancels a pending debounce when personal persistence is disabled", () => {
    const view = render(<Harness order={BASELINE} enabled />);
    view.rerender(<Harness order={["title", "org", "value"]} enabled />);
    vi.advanceTimersByTime(200);
    view.rerender(<Harness order={VIEW} enabled={false} />);
    vi.advanceTimersByTime(1000);
    expect(persist).not.toHaveBeenCalled();
  });

  it("cancels the pending unmount flush after disabling, even before the timer fires", () => {
    const view = render(<Harness order={BASELINE} enabled />);
    view.rerender(<Harness order={["title", "value", "org"]} enabled />);
    view.rerender(<Harness order={VIEW} enabled={false} />);
    view.unmount();
    expect(persist).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(persist).not.toHaveBeenCalled();
  });

  it("never queues saved-view column changes while disabled from initial mount", () => {
    const view = render(<Harness order={VIEW} enabled={false} />);
    view.rerender(<Harness order={["title", "org", "value"]} enabled={false} />);
    vi.advanceTimersByTime(1000);
    view.unmount();
    expect(persist).not.toHaveBeenCalled();
  });

  it("restoring the baseline cannot flush an earlier personal or temporary-view payload", () => {
    const previousPending = ["title", "org", "value"];
    const view = render(<Harness order={BASELINE} enabled />);
    view.rerender(<Harness order={previousPending} enabled />);
    view.rerender(<Harness order={VIEW} enabled={false} />);
    view.rerender(<Harness order={BASELINE} enabled={false} />);
    expect(persist).not.toHaveBeenCalled();
    view.rerender(<Harness order={BASELINE} enabled />);
    view.unmount();
    vi.advanceTimersByTime(1000);
    expect(persist).not.toHaveBeenCalledWith(
      { view: "dealsList", columns: previousPending },
      "csrf",
    );
    expect(persist).not.toHaveBeenCalledWith({ view: "dealsList", columns: VIEW }, "csrf");
    for (const [input] of persist.mock.calls)
      expect(input).toEqual({ view: "dealsList", columns: BASELINE });
  });

  it("resumes personal changes after leaving a saved view", () => {
    const view = render(<Harness order={BASELINE} enabled />);
    view.rerender(<Harness order={VIEW} enabled={false} />);
    view.rerender(<Harness order={BASELINE} enabled />);
    const personal = ["title", "value", "org"];
    view.rerender(<Harness order={personal} enabled />);
    vi.advanceTimersByTime(600);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({ view: "dealsList", columns: personal }, "csrf");
  });

  it("keeps the existing pending-unmount flush when the new option is absent", () => {
    const view = render(<Harness order={BASELINE} />);
    view.rerender(<Harness order={VIEW} />);
    view.unmount();
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({ view: "dealsList", columns: VIEW }, "csrf");
  });
});
