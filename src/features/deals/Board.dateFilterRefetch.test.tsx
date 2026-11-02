// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { BoardCard } from "./dealRepo";

const savePreferences = vi.hoisted(() => vi.fn());
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: savePreferences }));

const boardQuery = vi.hoisted(() => vi.fn(() => Promise.resolve({ cards: [] })));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

vi.mock("./useBoardRealtime", () => ({ useBoardRealtime: () => {} }));
vi.mock("@/features/presence/ui/PresenceBar", () => ({ PresenceBar: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/pipeline",
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      client: { deal: { board: { query: boardQuery } } },
      deal: { savedFilters: { invalidate: vi.fn() } },
    }),
    deal: { savedFilters: { useQuery: () => ({ data: [] }) } },
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    labels: {
      listByTarget: { useQuery: () => ({ data: [] }) },
      appliedNames: { useQuery: () => ({ data: [] }) },
    },
  },
}));
vi.mock("@/features/identity/preferencesActions", () => ({
  setBoardViewAction: () => Promise.resolve({ ok: true }),
}));

import { LocaleProvider, useSetLocalePreferences } from "@/features/i18n/LocaleProvider";
import { Board } from "./Board";
import type { BoardViewState } from "./boardView";
import { forgetBoardView, rememberBoardView } from "./boardViewMemory";
import { BOARD_QUERY_KEY } from "./useDealMove";

afterEach(() => {
  cleanup();
  forgetBoardView();
  boardQuery.mockClear();
  savePreferences.mockReset();
});

const PIPE = "11111111-1111-1111-1111-111111111111";
const ANA = "22222222-2222-2222-2222-222222222222";
const STAGES = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Alpha", order: 0, rottingDays: null },
];
const CARD: BoardCard = {
  id: "d0000000-0000-0000-0000-000000000001",
  title: "Deal One",
  value: "100.00",
  stageId: STAGES[0]?.id ?? "",
  boardPosition: "1",
  ownerId: ANA,
  ownerName: "Ana",
  personId: null,
  orgId: null,
  nextActivityAt: null,
  lastActivityAt: null,
  stageEnteredAt: new Date("2026-06-01T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function PreferenceControl() {
  const set = useSetLocalePreferences();
  return (
    <button
      type="button"
      onClick={() => void set({ calendar: "persian", locale: "fa", timeZone: "Asia/Tehran" })}
    >
      change-date-preferences
    </button>
  );
}

function renderBoard(
  conditions: BoardViewState["conditions"],
  qc = freshClient(),
  withPreferences = false,
) {
  const board = (
    <>
      {withPreferences && <PreferenceControl />}
      <Board
        pipelineId={PIPE}
        selfActorId={ANA}
        stages={STAGES}
        cards={[CARD]}
        pipelines={[{ id: PIPE, name: "Test pipeline", stages: [] }]}
        density="comfortable"
        serverNow={new Date("2026-06-01T00:00:00Z")}
        initialView={{
          ownerId: null,
          sortKey: "title",
          sortDir: "asc",
          savedFilter: null,
          conditions,
        }}
      />
    </>
  );
  return render(
    <QueryClientProvider client={qc}>
      {withPreferences ? (
        <LocaleProvider locale="en" timeZone="UTC">
          {board}
        </LocaleProvider>
      ) : (
        board
      )}
    </QueryClientProvider>,
  );
}

describe("board restored with a persisted filter", () => {
  test("refetches on mount with the saved UI zone when the filter has a date condition", async () => {
    renderBoard({ conditions: [{ field: "nextActivityAt", op: "eq", value: "today" }] });
    await waitFor(() => expect(boardQuery).toHaveBeenCalled());
    expect(boardQuery).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: PIPE, timeZone: expect.any(String) }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("keeps the server-rendered cards without a refetch for a non-date filter", async () => {
    renderBoard({ conditions: [{ field: "value", op: "gt", value: 50 }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(boardQuery).not.toHaveBeenCalled();
  });
});

describe("board remounted from the in-tab view memory", () => {
  const VALUE_FILTER: BoardViewState["conditions"] = {
    combinator: "and",
    conditions: [{ field: "value", op: "gt", value: 50 }],
  };

  test("refetches on mount even when the pipeline's cards are already cached and fresh", async () => {
    rememberBoardView({
      ownerId: null,
      sortKey: "title",
      sortDir: "asc",
      savedFilter: null,
      conditions: VALUE_FILTER,
    });
    const qc = freshClient();
    qc.setQueryData(BOARD_QUERY_KEY(PIPE), { cards: [CARD] });
    renderBoard(null, qc);
    await waitFor(() => expect(boardQuery).toHaveBeenCalled());
    expect(boardQuery).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: PIPE, definition: VALUE_FILTER }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("date context preference changes", () => {
  test("waits for persistence, refetches relative filters and keeps the shared board cache key", async () => {
    let finishSave!: (value: { ok: true }) => void;
    savePreferences.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = resolve;
      }),
    );
    const qc = freshClient();
    renderBoard(
      { conditions: [{ field: "expectedCloseDate", op: "eq", value: "this_month" }] },
      qc,
      true,
    );
    await waitFor(() => expect(boardQuery).toHaveBeenCalled());
    boardQuery.mockClear();
    fireEvent.click(screen.getByText("change-date-preferences"));
    await waitFor(() => expect(savePreferences).toHaveBeenCalled());
    expect(boardQuery).not.toHaveBeenCalled();
    await act(() => Promise.resolve(finishSave({ ok: true })));
    await waitFor(() =>
      expect(boardQuery).toHaveBeenCalledWith(
        expect.objectContaining({ timeZone: "Asia/Tehran", locale: "fa", calendar: "persian" }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    // Scope receipts extend the value; the load-bearing query identity stays the pipeline key.
    expect(qc.getQueryData(BOARD_QUERY_KEY(PIPE))).toMatchObject({ cards: [] });
    expect(qc.getQueryCache().getAll()).toHaveLength(1);
    expect(qc.getQueryCache().getAll()[0]?.queryKey).toEqual(BOARD_QUERY_KEY(PIPE));
  });
  test("does not refetch a non-date filter for calendar or timezone changes", async () => {
    savePreferences.mockResolvedValueOnce({ ok: true });
    renderBoard({ conditions: [{ field: "value", op: "gt", value: 50 }] }, freshClient(), true);
    fireEvent.click(screen.getByText("change-date-preferences"));
    await waitFor(() => expect(savePreferences).toHaveBeenCalled());
    await act(async () => {});
    expect(boardQuery).not.toHaveBeenCalled();
  });
});
