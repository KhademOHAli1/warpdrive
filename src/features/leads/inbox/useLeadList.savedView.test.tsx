// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

const requests = vi.hoisted(() => ({ fetch: vi.fn(), invalidate: vi.fn(async () => {}) }));
vi.mock("@/lib/trpc-client", async () => {
  const rq = await import("@tanstack/react-query");
  return {
    trpc: {
      useUtils: () => ({ lead: { list: { invalidate: requests.invalidate } } }),
      lead: {
        list: {
          useQuery: (input: { offset: number }, options: object) =>
            rq.useQuery({
              queryKey: ["lead.list", input],
              queryFn: () => requests.fetch(input.offset),
              ...options,
            }),
        },
      },
    },
  };
});

import { useLeadList } from "./useLeadList";

const params = {
  filter: "inbox" as const,
  sort: { field: "createdAt" as const, dir: "desc" as const },
  ownerIds: [],
  labelKeys: [],
  nextActivity: null,
  condition: null,
};
const labels = { user: { old: "Cached owner" }, person: {}, org: {} };
const page = { rows: [{ id: "old" }], total: 250, refLabels: labels };
afterEach(() => {
  cleanup();
  requests.fetch.mockReset();
  requests.invalidate.mockClear();
});
function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

test("unavailable selected lead view does not query or expose cached rows/counts/reference labels", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    [
      "lead.list",
      {
        filter: "inbox",
        offset: 0,
        limit: 200,
        sort: params.sort,
        filters: {
          ownerIds: undefined,
          labelKeys: undefined,
          nextActivity: undefined,
          condition: undefined,
        },
      },
    ],
    page,
  );
  requests.fetch.mockResolvedValue(page);
  const { result } = renderHook(() => useLeadList({ ...params, enabled: false }), {
    wrapper: wrapper(client),
  });
  await act(() => Promise.resolve());
  expect(requests.fetch).not.toHaveBeenCalled();
  expect(result.current.rows).toEqual([]);
  expect(result.current.total).toBe(0);
  expect(result.current.refLabels).toEqual({ user: {}, person: {}, org: {} });
  expect(result.current.canLoadMore).toBe(false);
  act(() => result.current.loadMore());
  await act(() => result.current.refetch());
  expect(requests.fetch).not.toHaveBeenCalled();
  expect(requests.invalidate).not.toHaveBeenCalled();
});

test("a lead request finishing after selected-view invalidation stays hidden", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let finish: (value: typeof page) => void = () => undefined;
  requests.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook(({ enabled }) => useLeadList({ ...params, enabled }), {
    initialProps: { enabled: true },
    wrapper: wrapper(client),
  });
  await waitFor(() => expect(requests.fetch).toHaveBeenCalledOnce());
  rerender({ enabled: false });
  await act(async () => {
    finish(page);
    await Promise.resolve();
  });
  expect(result.current.rows).toEqual([]);
  expect(result.current.total).toBe(0);
  expect(result.current.canLoadMore).toBe(false);
  expect(requests.fetch).toHaveBeenCalledOnce();
});

test("a valid narrower replacement does not redisplay a previous broader lead cache while loading", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requests.fetch.mockResolvedValueOnce(page);
  const { result, rerender } = renderHook(
    ({ enabled, condition }) => useLeadList({ ...params, enabled, condition }),
    {
      initialProps: {
        enabled: true,
        condition: null as null | {
          combinator: "and";
          conditions: { field: "title"; op: "contains"; value: string }[];
        },
      },
      wrapper: wrapper(client),
    },
  );
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  rerender({ enabled: false, condition: null });
  let finish: (value: typeof page) => void = () => undefined;
  requests.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  rerender({
    enabled: true,
    condition: {
      combinator: "and",
      conditions: [{ field: "title", op: "contains", value: "Narrow" }],
    },
  });
  expect(result.current.rows).toEqual([]);
  await act(async () => {
    finish({ ...page, rows: [{ id: "narrow" }], total: 1 });
    await Promise.resolve();
  });
  await waitFor(() => expect(result.current.rows.map((row) => row.id)).toEqual(["narrow"]));
});

test("a failed valid-view read retains a recoverable error rather than reporting an empty successful list", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  requests.fetch.mockRejectedValue(new Error("Synthetic query failure"));
  const { result } = renderHook(() => useLeadList({ ...params, enabled: true }), {
    wrapper: wrapper(client),
  });
  await waitFor(() => expect(result.current.error).toBe(true));
  expect(result.current.rows).toEqual([]);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.canLoadMore).toBe(false);
});
