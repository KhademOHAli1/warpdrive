// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dealClientFixture,
  FIRST_DEAL_VERSION,
  SECOND_DEAL_VERSION,
} from "@/features/deals/dealClientFixture";
import type { UpdateResult } from "./updateAction";
import { useInlineEdit } from "./useInlineEdit";

vi.mock("./updateAction");
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const liveKey = ["deal-list", "p1", "list", "none", "none"];
const otherPipelineKey = ["deal-list", "p2", "list", "none", "none"];

const seedData = {
  rows: [dealClientFixture({ id: "a", title: "Old", value: "1.00" })],
  total: 1,
  totalValue: "1.00",
};

const twoRowSeed = {
  rows: [
    dealClientFixture({ id: "a", title: "OldA", value: "1.00" }),
    dealClientFixture({ id: "b", title: "OldB", value: "2.00" }),
  ],
  total: 2,
  totalValue: "3.00",
};

function readTitle(client: QueryClient, key: unknown[], rowIndex = 0): string {
  const data = client.getQueryData(key) as { rows: Array<{ title: string }> };
  return data.rows[rowIndex]!.title;
}

describe("useInlineEdit", () => {
  it.each(["success", "conflict"] as const)(
    "preserves refreshed rows after a delayed edit %s",
    async (outcome) => {
      const { promise, resolve } = deferred<UpdateResult>();
      const { updateDealAction } = await import("./updateAction");
      vi.mocked(updateDealAction).mockClear().mockReturnValue(promise);
      const client = makeClient();
      client.setQueryData(liveKey, structuredClone(seedData));
      const { result } = renderHook(() => useInlineEdit("p1"), { wrapper: wrapper(client) });
      act(() => {
        void result.current.editCell({
          dealId: "a",
          field: "title",
          value: "Optimistic title",
          expectedWriteVersion: FIRST_DEAL_VERSION,
        });
      });
      await waitFor(() => expect(readTitle(client, liveKey)).toBe("Optimistic title"));
      const fresh = {
        ...seedData,
        rows: [
          dealClientFixture({
            id: "a",
            title: "Latest server title",
            writeVersion: "00000000-0000-4000-8000-000000000003",
          }),
          dealClientFixture({ id: "b", title: "Unrelated refresh" }),
        ],
        total: 2,
      };
      act(() => {
        client.setQueryData(liveKey, fresh);
      });
      const invalidated = vi.spyOn(client, "invalidateQueries");
      resolve(
        outcome === "success"
          ? {
              ok: true,
              deal: dealClientFixture({
                id: "a",
                title: "Older acknowledgment",
                writeVersion: SECOND_DEAL_VERSION,
              }),
            }
          : { ok: false, error: { id: "E_DEAL_002" } },
      );
      await waitFor(() => expect(invalidated).toHaveBeenCalled());
      expect(client.getQueryData(liveKey)).toEqual(fresh);
    },
  );

  it("does not optimistically mix an old draft with a freshly read different token", async () => {
    const { updateDealAction } = await import("./updateAction");
    vi.mocked(updateDealAction)
      .mockClear()
      .mockResolvedValue({ ok: false, error: { id: "E_DEAL_002" } });
    const client = makeClient();
    const fresh = {
      ...seedData,
      rows: [
        dealClientFixture({ id: "a", title: "Fresh title", writeVersion: SECOND_DEAL_VERSION }),
      ],
    };
    client.setQueryData(liveKey, fresh);
    const { result } = renderHook(() => useInlineEdit("p1"), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.editCell({
        dealId: "a",
        field: "title",
        value: "Old draft",
        expectedWriteVersion: FIRST_DEAL_VERSION,
      });
    });
    expect(client.getQueryData(liveKey)).toEqual(fresh);
  });

  it("reconciles the complete final row before a subsequent edit takes its token", async () => {
    const { updateDealAction } = await import("./updateAction");
    vi.mocked(updateDealAction)
      .mockResolvedValueOnce({
        ok: true,
        deal: dealClientFixture({
          id: "a",
          title: "Final server title",
          value: "25",
          writeVersion: SECOND_DEAL_VERSION,
        }),
      })
      .mockResolvedValueOnce({ ok: false, error: { id: "E_DEAL_002" } });
    const client = makeClient();
    client.setQueryData(liveKey, structuredClone(seedData));
    const { result } = renderHook(() => useInlineEdit("p1"), { wrapper: wrapper(client) });
    await act(async () => {
      await result.current.editCell({
        dealId: "a",
        field: "title",
        value: "Optimistic title",
        expectedWriteVersion: FIRST_DEAL_VERSION,
      });
    });
    const current = client.getQueryData<typeof seedData>(liveKey)?.rows[0];
    expect(current).toMatchObject({
      title: "Final server title",
      value: "25",
      writeVersion: SECOND_DEAL_VERSION,
    });
    await act(async () => {
      await result.current.editCell({
        dealId: "a",
        field: "title",
        value: "Next intent",
        expectedWriteVersion: current?.writeVersion ?? "",
      });
    });
    expect(updateDealAction).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedWriteVersion: SECOND_DEAL_VERSION }),
      null,
    );
  });

  it("optimistically patches the live deal-list cache then reverts on error", async () => {
    const { promise, resolve } = deferred<UpdateResult>();
    const { updateDealAction } = await import("./updateAction");
    vi.mocked(updateDealAction).mockReturnValue(promise);

    const client = makeClient();
    client.setQueryData(liveKey, structuredClone(seedData));
    client.setQueryData(otherPipelineKey, structuredClone(seedData));

    const { result } = renderHook(() => useInlineEdit("p1"), { wrapper: wrapper(client) });

    act(() => {
      void result.current.editCell({
        dealId: "a",
        field: "title",
        value: "New",
        expectedWriteVersion: "00000000-0000-4000-8000-000000000001",
      });
    });

    await waitFor(() => {
      expect(readTitle(client, liveKey)).toBe("New");
    });
    expect(readTitle(client, otherPipelineKey)).toBe("Old");

    resolve({ ok: false, error: { id: "E_DEAL_002" } });

    await waitFor(() => {
      expect(readTitle(client, liveKey)).toBe("Old");
    });
  });

  it("rolls back only the failed row, keeping a later overlapping edit intact", async () => {
    const first = deferred<UpdateResult>();
    const second = deferred<UpdateResult>();
    const { updateDealAction } = await import("./updateAction");
    vi.mocked(updateDealAction)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const client = makeClient();
    client.setQueryData(liveKey, structuredClone(twoRowSeed));

    const { result } = renderHook(() => useInlineEdit("p1"), { wrapper: wrapper(client) });

    act(() => {
      void result.current.editCell({
        dealId: "a",
        field: "title",
        value: "NewA",
        expectedWriteVersion: "00000000-0000-4000-8000-000000000001",
      });
    });
    await waitFor(() => {
      expect(readTitle(client, liveKey, 0)).toBe("NewA");
    });

    act(() => {
      void result.current.editCell({
        dealId: "b",
        field: "title",
        value: "NewB",
        expectedWriteVersion: "00000000-0000-4000-8000-000000000001",
      });
    });
    await waitFor(() => {
      expect(readTitle(client, liveKey, 1)).toBe("NewB");
    });

    first.resolve({ ok: false, error: { id: "E_DEAL_002" } });

    await waitFor(() => {
      expect(readTitle(client, liveKey, 0)).toBe("OldA");
    });
    expect(readTitle(client, liveKey, 1)).toBe("NewB");

    second.resolve({
      ok: true,
      deal: dealClientFixture({ id: "b", updatedAt: "2026-06-29T00:00:01.000Z" }),
    });
  });

  it("invalidates the deal-list queries for the pipeline on settled", async () => {
    const { updateDealAction } = await import("./updateAction");
    vi.mocked(updateDealAction).mockResolvedValue({ ok: false, error: { id: "E_DEAL_002" } });

    const client = makeClient();
    client.setQueryData(liveKey, structuredClone(seedData));

    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useInlineEdit("p1"), { wrapper: wrapper(client) });

    act(() => {
      void result.current.editCell({
        dealId: "a",
        field: "title",
        value: "New",
        expectedWriteVersion: "00000000-0000-4000-8000-000000000001",
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["deal-list", "p1"] }),
      );
    });
  });
});
