// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import english from "../messages/operations.en.json";
import { ObservationDetails } from "./ObservationDetails";
import { OperationsLogs } from "./OperationsLogs";
import { OperationsMaintenance } from "./OperationsMaintenance";
import { createOperationsReadSlot, readOperationsPair } from "./readCycle";
import type { ObservationPage, ObservationRow } from "./types";
import {
  OPERATIONS_POLL_MS,
  OPERATIONS_READ_DEADLINE_MS,
  useOperationsRead,
} from "./useOperationsRead";
import {
  OPERATIONS_CURSOR_HISTORY_LIMIT,
  operationsVisibleState,
  useOperationsCursor,
} from "./viewState";

const api = vi.hoisted(() => {
  const observations = vi.fn(),
    sources = vi.fn(),
    incidents = vi.fn(),
    events = vi.fn();
  return {
    observations,
    sources,
    incidents,
    events,
    client: {
      operations: {
        observations: { query: observations },
        sources: { query: sources },
        incidents: { query: incidents },
        events: { query: events },
      },
    },
  };
});
vi.mock("@/lib/trpc-client", () => ({ trpc: { useUtils: () => ({ client: api.client }) } }));
vi.mock("@/features/i18n/LocaleProvider", () => ({
  useMessages: () => ({ operations: english }),
  useLocalePreferences: () => ({ locale: "en", calendar: "gregory", timeZone: "UTC" }),
}));
const at = Date.parse("2026-11-11T12:00:00.000Z");
const iso = new Date(at).toISOString();
function row(): ObservationRow {
  return {
    sourceId: "source-private",
    observationKey: "feature:crm",
    generationId: "generation",
    sequence: 1,
    receiptId: "receipt",
    payloadSha256: "a".repeat(64),
    sourceState: "active",
    observation: { kind: "feature", feature: "crm", state: "healthy", reason: "ok" },
    state: "healthy",
    reason: "ok",
    freshness: { status: "current", reason: "current", ageMs: 0, staleAtMs: at + 2000 },
    observedAt: iso,
    receivedAt: iso,
  };
}
function page(): ObservationPage {
  return { items: [row()], nextCursor: null, checkedAt: iso };
}
function pending<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function refusal(code = "FORBIDDEN") {
  return new TRPCClientError("private server detail", {
    result: { error: { code: -32003, message: "denied", data: { code } } },
  });
}
async function flush(milliseconds = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
  vi.setSystemTime(0);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  api.observations.mockReset().mockResolvedValue(page());
  api.sources.mockReset().mockResolvedValue({
    items: [
      {
        sourceId: "source-private",
        role: "application_sampler",
        active: true,
        admissionState: "storage_pressure",
        generationId: "generation",
        highestSequence: 1,
        createdAt: iso,
      },
    ],
    nextCursor: null,
  });
  api.incidents.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  api.events.mockReset().mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  await Promise.resolve();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("operations UI freshness and privacy", () => {
  it("ages server-checked health with monotonic time and never treats invalid/null freshness as healthy", () => {
    const value = row();
    expect(operationsVisibleState(value, iso, 100, 100, false)).toBe("healthy");
    expect(operationsVisibleState(value, iso, 100, 2100, false)).toBe("stale");
    expect(operationsVisibleState(value, iso, 100, 100, true)).toBe("unknown");
    expect(
      operationsVisibleState({ ...value, sourceState: "storage_pressure" }, iso, 100, 100, false),
    ).toBe("unknown");
    expect(
      operationsVisibleState(
        { ...value, freshness: { ...value.freshness, staleAtMs: null } },
        iso,
        100,
        100,
        false,
      ),
    ).toBe("unknown");
    expect(operationsVisibleState(value, "invalid", 100, 100, false)).toBe("unknown");
    expect(operationsVisibleState(value, iso, 100, 99, false)).toBe("unknown");
  });

  it("shows only page-scoped health, makes enrollment meaning explicit, and expires green without another response", async () => {
    render(<OperationsMaintenance />);
    await flush();
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getAllByText(english.pageScope, { exact: false })).toHaveLength(2);
    expect(screen.getByText(english.sourcesInfo)).toBeTruthy();
    expect(screen.getByText(english.enrollmentActive)).toBeTruthy();
    expect(screen.getByText(english.sourceState.storage_pressure)).toBeTruthy();
    await flush(2100);
    expect(screen.queryByText("Healthy")).toBeNull();
    expect(screen.getByText("Stale")).toBeTruthy();
    expect(api.observations).toHaveBeenCalledTimes(1);
  });

  it("renders null queue ages/counts as not reported and preserves a genuine zero", () => {
    render(
      <ObservationDetails
        observation={{
          kind: "queue",
          queue: "file.reaper",
          state: "unknown",
          reason: "not_reported",
          sampledAtMs: null,
          pendingCount: 0,
          activeCount: null,
          readyOldestAgeMs: null,
          lastProgressAtMs: null,
        }}
      />,
    );
    const age = screen.getByText(english.readyOldestAge).parentElement!;
    expect(within(age).getByText(english.unknownValue)).toBeTruthy();
    const pendingJobs = screen.getByText(english.pendingCount).parentElement!;
    expect(within(pendingJobs).getByText("0")).toBeTruthy();
  });

  it("shows reported image identity rather than a latest release value", () => {
    render(
      <ObservationDetails
        observation={{
          kind: "component",
          component: "web",
          state: "healthy",
          reason: "ok",
          latencyMs: null,
          installed: {
            evidence: "inspected",
            imageDigest: `sha256:${"b".repeat(64)}`,
            sourceRevision: "c".repeat(40),
            configurationSha256: "d".repeat(64),
            schemaSha256: null,
          },
        }}
      />,
    );
    expect(screen.getByText(english.reportedIdentity)).toBeTruthy();
    expect(screen.getByText(`sha256:${"b".repeat(64)}`)).toBeTruthy();
    expect(screen.getByText("c".repeat(40))).toBeTruthy();
    expect(screen.getByText(english.unknownValue)).toBeTruthy();
  });

  it.each(["FORBIDDEN", "UNAUTHORIZED"])(
    "hides all private section data on confirmed %s and waits for explicit refresh",
    async (code) => {
      render(<OperationsMaintenance />);
      await flush();
      expect(screen.getAllByText("source-private").length).toBeGreaterThan(0);
      api.observations.mockRejectedValueOnce(refusal(code));
      fireEvent.click(screen.getByRole("button", { name: english.refresh }));
      await flush();
      expect(screen.queryByText("source-private")).toBeNull();
      expect(screen.getByText(english.denied)).toBeTruthy();
      expect(screen.queryByText("private server detail")).toBeNull();
      await flush(3 * OPERATIONS_POLL_MS);
      expect(api.observations).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole("button", { name: english.refresh }));
      await flush();
      expect(screen.queryByText(english.denied)).toBeNull();
      expect(screen.getAllByText("source-private").length).toBeGreaterThan(0);
    },
  );

  it("turns retained health unknown on an ignored deadline and hides stale source admission", async () => {
    const initial = page();
    initial.items[0]!.freshness.staleAtMs = at + 600_000;
    api.observations.mockResolvedValue(initial);
    const view = render(<OperationsMaintenance />);
    await flush();
    expect(screen.getByText("Healthy")).toBeTruthy();
    const hanging = pending<ObservationPage>();
    api.observations.mockReturnValueOnce(hanging.promise);
    fireEvent.click(screen.getByRole("button", { name: english.refresh }));
    await flush();
    await flush(OPERATIONS_READ_DEADLINE_MS);
    expect(screen.queryByText("Healthy")).toBeNull();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText(english.enrollmentActive)).toBeNull();
    expect(screen.getByRole("button", { name: english.refresh }).hasAttribute("disabled")).toBe(
      true,
    );
    await flush(2 * OPERATIONS_POLL_MS);
    expect(api.observations).toHaveBeenCalledTimes(2);
    view.unmount();
    hanging.resolve(initial);
    await flush();
  });

  it("hides both private result sets immediately when one read denies access and the other ignores abort", async () => {
    const view = render(<OperationsMaintenance />);
    await flush();
    const hanging = pending<unknown>();
    api.observations.mockRejectedValueOnce(refusal());
    api.sources.mockReturnValueOnce(hanging.promise);
    fireEvent.click(screen.getByRole("button", { name: english.refresh }));
    await flush();
    expect(screen.queryByText("source-private")).toBeNull();
    expect(screen.getByText(english.denied)).toBeTruthy();
    expect(screen.getByRole("button", { name: english.refresh }).hasAttribute("disabled")).toBe(
      true,
    );
    await flush(2 * OPERATIONS_POLL_MS);
    expect(api.observations).toHaveBeenCalledTimes(2);
    view.unmount();
    hanging.resolve({ items: [], nextCursor: null });
    await flush();
  });

  it("sends only the selected cursor, replaces the visible page, and can go back", async () => {
    const next = { sourceId: "cursor-source", observationKey: "feature:crm" };
    api.observations.mockImplementation((input: { cursor?: unknown }) =>
      Promise.resolve({
        ...page(),
        items: [{ ...row(), sourceId: input.cursor === undefined ? "page-one" : "page-two" }],
        nextCursor: input.cursor === undefined ? next : null,
      }),
    );
    render(<OperationsMaintenance />);
    await flush();
    const observations = screen.getByRole("region", { name: english.observationsTitle });
    fireEvent.click(within(observations).getByRole("button", { name: english.next }));
    await flush();
    expect(api.observations.mock.calls.at(-1)![0]).toEqual({ cursor: next });
    expect(screen.queryByText("page-one")).toBeNull();
    expect(screen.getByText("page-two")).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("region", { name: english.observationsTitle })).getByRole("button", {
        name: english.previous,
      }),
    );
    await flush();
    expect(api.observations.mock.calls.at(-1)![0]).toEqual({ cursor: undefined });
    expect(screen.getByText("page-one")).toBeTruthy();
  });

  it("makes empty pages explicit without inferring that the installation is healthy", async () => {
    api.observations.mockResolvedValue({ ...page(), items: [] });
    api.sources.mockResolvedValue({ items: [], nextCursor: null });
    render(<OperationsMaintenance />);
    await flush();
    expect(screen.getByText(english.emptyObservations)).toBeTruthy();
    expect(screen.getByText(english.emptySources)).toBeTruthy();
    expect(screen.queryByText("Healthy")).toBeNull();
  });

  it("labels recovered incidents from recoveredAt and exposes only receipt metadata", async () => {
    api.incidents.mockResolvedValue({
      items: [
        {
          id: "incident-private",
          sourceId: "source-private",
          observationKey: "feature:crm",
          state: "failed",
          reason: "check_failed",
          revision: 2,
          openedAt: iso,
          updatedAt: iso,
          recoveredAt: iso,
        },
      ],
      nextCursor: null,
    });
    api.events.mockResolvedValue({
      items: [
        {
          receiptId: "receipt-private",
          sourceId: "source-private",
          generationId: "generation",
          sequence: 1,
          payloadSha256: "a".repeat(64),
          observationCount: 1,
          observedAt: iso,
          receivedAt: iso,
          recordedAt: iso,
          payload: "not-rendered-private-payload",
        },
      ],
      nextCursor: null,
    });
    render(<OperationsLogs />);
    await flush();
    expect(screen.getByText(english.recovered)).toBeTruthy();
    expect(screen.getByText("receipt-private")).toBeTruthy();
    expect(screen.queryByText("not-rendered-private-payload")).toBeNull();
    expect(api.incidents.mock.calls[0]![0]).toMatchObject({ openOnly: true });
    fireEvent.click(screen.getByRole("checkbox", { name: english.openOnly }));
    await flush();
    expect(api.incidents.mock.calls.at(-1)![0]).toMatchObject({
      openOnly: false,
      cursor: undefined,
    });
  });
});

describe("owned read cycles", () => {
  it("waits for both reads to actually settle even when the first rejects, while reporting denial immediately", async () => {
    const hanging = pending<number>();
    const denied = vi.fn();
    const pair = readOperationsPair(
      () => Promise.reject(refusal()),
      () => hanging.promise,
      denied,
    );
    let ended = false;
    const observed = pair.catch(() => {
      ended = true;
    });
    await flush();
    expect(denied).toHaveBeenCalledOnce();
    expect(ended).toBe(false);
    hanging.resolve(1);
    await observed;
    expect(ended).toBe(true);
  });

  it("holds a timed-out ignored-abort cycle, projects unknown, and prevents polling/Refresh accumulation", async () => {
    const slot = createOperationsReadSlot();
    const late = pending<ObservationPage>();
    const following = pending<ObservationPage>();
    const signals: AbortSignal[] = [];
    const read = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? late.promise : following.promise;
    });
    const hook = renderHook(() => useOperationsRead("page", read, slot));
    await flush();
    const signal = read.mock.calls[0]![0];
    await flush(OPERATIONS_READ_DEADLINE_MS);
    expect(signal.aborted).toBe(true);
    expect(hook.result.current.failure).toBe("timeout");
    expect(hook.result.current.busy).toBe(true);
    act(() => hook.result.current.refresh());
    await flush(3 * OPERATIONS_POLL_MS);
    expect(read).toHaveBeenCalledTimes(1);
    late.resolve(page());
    await flush();
    expect(hook.result.current.data).toBeUndefined();
    hook.unmount();
    following.resolve(page());
    await flush();
  });

  it.each(["resolve", "reject"])(
    "rejects late %s after monotonic deadline even if the timeout callback never ran",
    async (outcome) => {
      const clock = vi.spyOn(performance, "now").mockReturnValue(0);
      const slot = createOperationsReadSlot();
      const late = pending<string>();
      const read = vi.fn(() => late.promise);
      const hook = renderHook(() => useOperationsRead("page", read, slot));
      await flush();
      clock.mockReturnValue(OPERATIONS_READ_DEADLINE_MS + 1);
      if (outcome === "resolve") late.resolve("must-not-publish");
      else late.reject(new Error("late network failure"));
      await flush(); // fake timer time remains zero; only performance.now moved.
      expect(hook.result.current.data).toBeUndefined();
      expect(hook.result.current.failure).toBe("timeout");
      expect(hook.result.current.busy).toBe(false);
      expect(read).toHaveBeenCalledOnce();
    },
  );

  it("expires a held read on visibility resume without waiting for its delayed timer", async () => {
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const slot = createOperationsReadSlot();
    const late = pending<string>();
    const read = vi.fn(() => late.promise);
    const hook = renderHook(() => useOperationsRead("page", read, slot));
    await flush();
    visibility.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    clock.mockReturnValue(OPERATIONS_READ_DEADLINE_MS + 1);
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(hook.result.current.failure).toBe("timeout");
    expect(hook.result.current.busy).toBe(true);
    expect(read).toHaveBeenCalledOnce();
    hook.unmount();
    late.resolve("discarded");
    await flush();
  });

  it("ignores an already queued deadline callback from a completed older read", async () => {
    const timeouts = vi.spyOn(globalThis, "setTimeout");
    const slot = createOperationsReadSlot();
    const late = pending<string>();
    const read = vi.fn().mockResolvedValueOnce("first").mockReturnValueOnce(late.promise);
    const hook = renderHook(() => useOperationsRead("page", read, slot));
    await flush();
    const oldDeadline = timeouts.mock.calls.find(
      (call) => call[1] === OPERATIONS_READ_DEADLINE_MS,
    )![0];
    act(() => hook.result.current.refresh());
    await flush();
    act(() => {
      if (typeof oldDeadline === "function") oldDeadline();
    });
    expect(hook.result.current.failure).toBeNull();
    expect((read.mock.calls[1]![0] as AbortSignal).aborted).toBe(false);
    hook.unmount();
    late.resolve("discarded");
    await flush();
  });

  it("preserves the sole slot across unmount/remount and ignores the prior result", async () => {
    const slot = createOperationsReadSlot();
    const old = pending<string>();
    const readOld = vi.fn((signal: AbortSignal) => {
        signal.throwIfAborted();
        return old.promise;
      }),
      readNew = vi.fn(() => Promise.resolve("new-private"));
    const first = renderHook(() => useOperationsRead("old", readOld, slot));
    await flush();
    const signal = readOld.mock.calls[0]![0];
    first.unmount();
    expect(signal.aborted).toBe(true);
    const replacement = renderHook(() => useOperationsRead("new", readNew, slot));
    await flush(OPERATIONS_POLL_MS);
    expect(readNew).not.toHaveBeenCalled();
    old.resolve("old-private");
    await flush();
    expect(readNew).toHaveBeenCalledOnce();
    expect(replacement.result.current.data).toBe("new-private");
  });

  it("does no initial hidden-tab work and discards data immediately when the read selection changes", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const slot = createOperationsReadSlot();
    const first = vi.fn(() => Promise.resolve("private-old"));
    const second = pending<string>();
    const next = vi.fn(() => second.promise);
    const hook = renderHook(({ key, read }) => useOperationsRead(key, read, slot), {
      initialProps: { key: "one", read: first },
    });
    await flush(OPERATIONS_POLL_MS);
    expect(first).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(hook.result.current.data).toBe("private-old");
    hook.rerender({ key: "two", read: next });
    expect(hook.result.current.data).toBeUndefined();
    await flush();
    second.resolve("private-new");
    await flush();
    expect(hook.result.current.data).toBe("private-new");
  });

  it("polls once per minute only while visible and removes all timers/listeners on unmount", async () => {
    const visible = vi.spyOn(document, "visibilityState", "get");
    const slot = createOperationsReadSlot();
    const read = vi.fn(() => Promise.resolve("ok"));
    const hook = renderHook(() => useOperationsRead("page", read, slot));
    await flush();
    await flush(OPERATIONS_POLL_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await flush(1);
    expect(read).toHaveBeenCalledTimes(2);
    visible.mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush(3 * OPERATIONS_POLL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    visible.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(read).toHaveBeenCalledTimes(3);
    hook.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush(OPERATIONS_POLL_MS);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

it("bounds cursor history, rejects duplicate next tokens, and can return to the first page", () => {
  const hook = renderHook(() => useOperationsCursor<string>());
  for (let index = 1; index < OPERATIONS_CURSOR_HISTORY_LIMIT; index++)
    act(() => hook.result.current.next(`cursor-${index}`));
  expect(hook.result.current.page).toBe(OPERATIONS_CURSOR_HISTORY_LIMIT);
  expect(hook.result.current.canNext("overflow")).toBe(false);
  act(() => hook.result.current.next("overflow"));
  expect(hook.result.current.cursor).toBe("cursor-9");
  act(() => hook.result.current.previous());
  expect(hook.result.current.canNext("cursor-8")).toBe(false);
  act(() => hook.result.current.first());
  expect(hook.result.current.page).toBe(1);
  expect(hook.result.current.cursor).toBeUndefined();
});
