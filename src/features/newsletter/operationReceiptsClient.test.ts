// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import {
  useNewsletterReceipt,
  useNewsletterReceiptResolution,
  useNewsletterWrite,
  usePendingNewsletterReceiptIds,
} from "./ui/client";

const mocks = vi.hoisted(() => ({
  mutate:
    vi.fn<
      (command: {
        operation: string;
        operationId?: string;
        input: Record<string, unknown>;
      }) => Promise<unknown>
    >(),
  fetchReceipt: vi.fn(),
  queryReceipt: vi.fn(),
  resolveReceipt: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    newsletter: {
      write: {
        useMutation: () => ({ mutateAsync: mocks.mutate, isPending: false, error: null }),
      },
      receipt: { useQuery: mocks.queryReceipt },
      resolveReceipt: {
        useMutation: () => ({ mutateAsync: mocks.resolveReceipt, isPending: false, error: null }),
      },
    },
    useUtils: () => ({
      newsletter: {
        read: { invalidate: mocks.invalidate },
        receipt: { fetch: mocks.fetchReceipt, invalidate: mocks.invalidate },
      },
    }),
  },
}));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.resetAllMocks();
});

const operation = "subscribers.create";
const input = { email: "synthetic-private@example.test" };

function actor(actorId: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(NativeActorProvider, { actorId, children });
}

test("a same-actor tab remount retains only the opaque ID for a committed replay", async () => {
  mocks.mutate.mockRejectedValueOnce(new Error("Synthetic transport interruption"));
  mocks.fetchReceipt.mockResolvedValue({ state: "succeeded", result: { id: 15 } });
  const first = renderHook(() => useNewsletterWrite(), { wrapper: actor("first-actor") });
  await expect(first.result.current.run(operation, input)).rejects.toThrow(
    "Synthetic transport interruption",
  );
  const id = first.result.current.pendingOperationId(operation);
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.values(sessionStorage)).toEqual([id]);
  expect(first.result.current.pendingOperationId("subscribers.update")).toBeNull();
  first.unmount();

  const other = renderHook(() => useNewsletterWrite(), { wrapper: actor("other-actor") });
  expect(other.result.current.pendingOperationId(operation)).toBeNull();
  other.unmount();
  const reloaded = renderHook(() => useNewsletterWrite(), { wrapper: actor("first-actor") });
  expect(reloaded.result.current.pendingOperationId(operation)).toBe(id);
  mocks.mutate.mockResolvedValueOnce({ id: 15 });
  await expect(reloaded.result.current.run(operation, input)).resolves.toEqual({ id: 15 });
  expect(mocks.mutate.mock.calls.map(([command]) => command.operationId)).toEqual([id, id]);
  expect(sessionStorage.length).toBe(0);
});

test("an unknown receipt reuses its ID until the operator records an explicit review", async () => {
  mocks.mutate.mockRejectedValue(new Error("Synthetic unknown effect"));
  mocks.fetchReceipt.mockResolvedValue({ state: "unknown", resolution: null });
  const mounted = renderHook(
    () => ({ write: useNewsletterWrite(), review: useNewsletterReceiptResolution() }),
    { wrapper: actor("first-actor") },
  );
  await expect(mounted.result.current.write.run(operation, input)).rejects.toThrow(
    "Synthetic unknown effect",
  );
  const id = mounted.result.current.write.pendingOperationId(operation);
  if (id === null) throw new Error("The synthetic operation ID was lost");
  await expect(mounted.result.current.write.run(operation, input)).rejects.toThrow(
    "Synthetic unknown effect",
  );
  expect(mocks.mutate.mock.calls.map(([command]) => command.operationId)).toEqual([id, id]);
  expect(sessionStorage.length).toBe(1);

  mocks.resolveReceipt.mockResolvedValueOnce({ operation, operationId: id });
  await mounted.result.current.review.run(id, {
    outcome: "notApplied",
    evidenceSource: "engineLog",
    evidenceReference: "OPS-12",
  });
  expect(mounted.result.current.write.pendingOperationId(operation)).toBeNull();
  expect(sessionStorage.length).toBe(0);
  expect(mocks.mutate).toHaveBeenCalledTimes(2);
});

test("Logs exposes only this actor's pending IDs and acknowledges an explicitly inspected success", () => {
  const id = "51fab8a3-0660-44a3-9bf4-0c2b36f9a40b";
  const otherId = "fbc1ba9a-09dd-4c3b-906f-3ad09b2e0531";
  sessionStorage.setItem(`warpdrive:newsletter:pending:v1:first-actor:${operation}`, id);
  sessionStorage.setItem(`warpdrive:newsletter:pending:v1:other-actor:${operation}`, otherId);
  const mounted = renderHook(() => usePendingNewsletterReceiptIds(), {
    wrapper: actor("first-actor"),
  });
  expect(mounted.result.current).toEqual([id]);
  mocks.queryReceipt.mockReturnValue({ data: { state: "succeeded", operation, operationId: id } });
  renderHook(() => useNewsletterReceipt(id), { wrapper: actor("first-actor") });
  expect(mounted.result.current).toEqual([]);
  expect(Object.values(sessionStorage)).toEqual([otherId]);
  expect(mocks.mutate).not.toHaveBeenCalled();
});

test("an uncertain start leaves emergency stops and other campaigns available", async () => {
  const command = "campaigns.status";
  const start = { id: 12, status: "running" };
  const pause = { id: 12, status: "paused" };
  const other = { id: 31, status: "running" };
  const mounted = renderHook(
    () => ({ write: useNewsletterWrite(), review: useNewsletterReceiptResolution() }),
    { wrapper: actor("first-actor") },
  );
  mocks.mutate
    .mockRejectedValueOnce(new Error("Synthetic lost start"))
    .mockResolvedValueOnce({ id: 12 })
    .mockResolvedValueOnce({ id: 31 })
    .mockRejectedValueOnce(new Error("Synthetic unresolved start"));
  mocks.fetchReceipt.mockResolvedValue({ state: "unknown", resolution: null });

  await expect(mounted.result.current.write.run(command, start)).rejects.toThrow("lost start");
  const startId = mounted.result.current.write.pendingOperationId(command, start);
  if (startId === null) throw new Error("The start receipt ID was lost");
  await expect(mounted.result.current.write.run(command, pause)).resolves.toEqual({ id: 12 });
  await expect(mounted.result.current.write.run(command, other)).resolves.toEqual({ id: 31 });
  await expect(mounted.result.current.write.run(command, start)).rejects.toThrow(
    "unresolved start",
  );
  const ids = mocks.mutate.mock.calls.map(([request]) => request.operationId);
  expect(ids[0]).toBe(startId);
  expect(ids[3]).toBe(startId);
  expect(new Set(ids).size).toBe(3);
  expect(Object.values(sessionStorage)).toEqual([startId]);

  mocks.resolveReceipt.mockResolvedValueOnce({ operation: command, operationId: startId });
  await mounted.result.current.review.run(startId, {
    outcome: "applied",
    evidenceSource: "engineRecord",
    evidenceReference: "12",
  });
  expect(sessionStorage.length).toBe(0);
});
