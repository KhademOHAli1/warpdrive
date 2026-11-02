// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardData } from "./boardCache";
import { midpoint } from "./boardPosition";
import { dealClientFixture, FIRST_DEAL_VERSION, SECOND_DEAL_VERSION } from "./dealClientFixture";
import type { MoveResult } from "./moveAction";
import { useDealMove } from "./useDealMove";

vi.mock("./moveAction");
afterEach(cleanup);

// Helper: deferred promise so tests can assert optimistic state before settling.
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

const baseCard = {
  id: "a",
  title: "a",
  value: null,
  stageId: "s1",
  boardPosition: "1",
  ownerId: "u",
  personId: null,
  orgId: null,
  nextActivityAt: null,
  lastActivityAt: null,
  stageEnteredAt: new Date(),
  writeVersion: "00000000-0000-4000-8000-000000000001",
  updatedAt: new Date(),
} as const;

describe("useDealMove", () => {
  it.each(["success", "conflict"] as const)(
    "preserves a newer row and unrelated refresh after a delayed %s",
    async (outcome) => {
      const { promise, resolve } = deferred<MoveResult>();
      const { moveDealAction } = await import("./moveAction");
      vi.mocked(moveDealAction).mockClear().mockReturnValue(promise);
      const client = makeClient();
      const key = ["board", "p1"];
      client.setQueryData<BoardData>(key, { cards: [{ ...baseCard }] });
      const { result } = renderHook(() => useDealMove("p1"), { wrapper: wrapper(client) });
      act(() =>
        result.current.move({
          dealId: "a",
          toStageId: "s2",
          beforePosition: null,
          afterPosition: null,
          expectedWriteVersion: FIRST_DEAL_VERSION,
        }),
      );
      await waitFor(() =>
        expect(client.getQueryData<BoardData>(key)?.cards[0]?.stageId).toBe("s2"),
      );
      const latest = {
        ...baseCard,
        title: "Current authoritative title",
        stageId: "s3",
        writeVersion: "00000000-0000-4000-8000-000000000003",
      };
      const unrelated = {
        ...baseCard,
        id: "b",
        title: "Other actor's refreshed card",
        writeVersion: "00000000-0000-4000-8000-000000000004",
      };
      act(() => {
        client.setQueryData<BoardData>(key, { cards: [latest, unrelated] });
      });
      const invalidated = vi.spyOn(client, "invalidateQueries");
      resolve(
        outcome === "success"
          ? {
              ok: true,
              deal: dealClientFixture({
                id: "a",
                stageId: "s2",
                title: "Earlier acknowledgment",
                writeVersion: SECOND_DEAL_VERSION,
              }),
            }
          : { ok: false, error: { id: "E_DEAL_002" } },
      );
      await waitFor(() => expect(invalidated).toHaveBeenCalled());
      expect(client.getQueryData<BoardData>(key)?.cards).toEqual([latest, unrelated]);
    },
  );

  it("does not paint a stale gesture onto a freshly loaded different version", async () => {
    const { promise, resolve } = deferred<MoveResult>();
    const { moveDealAction } = await import("./moveAction");
    vi.mocked(moveDealAction).mockClear().mockReturnValue(promise);
    const client = makeClient();
    const latest = { ...baseCard, stageId: "s3", writeVersion: SECOND_DEAL_VERSION };
    client.setQueryData<BoardData>(["board", "p1"], { cards: [latest] });
    const { result } = renderHook(() => useDealMove("p1"), { wrapper: wrapper(client) });
    act(() =>
      result.current.move({
        dealId: "a",
        toStageId: "s2",
        beforePosition: null,
        afterPosition: null,
        expectedWriteVersion: FIRST_DEAL_VERSION,
      }),
    );
    await waitFor(() => expect(moveDealAction).toHaveBeenCalledTimes(1));
    expect(client.getQueryData<BoardData>(["board", "p1"])?.cards[0]).toEqual(latest);
    const invalidated = vi.spyOn(client, "invalidateQueries");
    resolve({ ok: false, error: { id: "E_DEAL_002" } });
    await waitFor(() => expect(invalidated).toHaveBeenCalled());
  });

  it("optimistically patches the cache before the mutation settles", async () => {
    const { promise, resolve } = deferred<MoveResult>();
    const { moveDealAction } = await import("./moveAction");
    vi.mocked(moveDealAction).mockReturnValue(promise);

    const client = makeClient();
    const initial: BoardData = { cards: [{ ...baseCard }] };
    client.setQueryData(["board", "p1"], initial);

    const { result } = renderHook(() => useDealMove("p1"), { wrapper: wrapper(client) });

    act(() => {
      result.current.move({
        dealId: "a",
        toStageId: "s2",
        beforePosition: null,
        afterPosition: null,
        expectedWriteVersion: "00000000-0000-4000-8000-000000000001",
      });
    });

    // onMutate is async (cancelQueries), so wait for the optimistic patch to land.
    await waitFor(() => {
      expect((client.getQueryData(["board", "p1"]) as BoardData).cards[0]!.stageId).toBe("s2");
    });

    // Now settle with a stale-precondition error: cache should roll back to s1.
    resolve({ ok: false, error: { id: "E_DEAL_002" } });

    await waitFor(() => {
      expect((client.getQueryData(["board", "p1"]) as BoardData).cards[0]!.stageId).toBe("s1");
    });

    // sanity: midpoint helper imported correctly
    expect(midpoint(null, null)).toBe("1");
  });

  it("invalidates the board query on settled", async () => {
    const { moveDealAction } = await import("./moveAction");
    vi.mocked(moveDealAction).mockResolvedValue({ ok: false, error: { id: "E_DEAL_002" } });

    const client = makeClient();
    client.setQueryData(["board", "p1"], { cards: [] } satisfies BoardData);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useDealMove("p1"), { wrapper: wrapper(client) });

    act(() => {
      result.current.move({
        dealId: "x",
        toStageId: "s2",
        beforePosition: null,
        afterPosition: null,
        expectedWriteVersion: "00000000-0000-4000-8000-000000000001",
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["board", "p1"] }),
      );
    });
  });
});
