// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { baseCard } from "./dealCardTestFixture";

const { captureMock, moveMock, refreshMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  moveMock: vi.fn(),
  refreshMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/features/observability/capture", () => ({
  capture: captureMock,
  currentRoute: () => "/pipeline/1",
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    DndContext: ({
      children,
      onDragCancel,
      onDragStart,
      onDragEnd,
    }: {
      children?: ReactNode;
      onDragCancel?: () => void;
      onDragStart?: (event: { active: { id: string } }) => void;
      onDragEnd?: (event: { active: { id: string }; over: { id: string } }) => void;
    }) => (
      <div>
        <button type="button" onClick={() => onDragStart?.({ active: { id: "d1" } })}>
          Start drag
        </button>
        <button type="button" onClick={() => onDragCancel?.()}>
          Cancel drag
        </button>
        <button
          type="button"
          onClick={() => onDragEnd?.({ active: { id: "d1" }, over: { id: "stage-2" } })}
        >
          Finish drag
        </button>
        {children}
      </div>
    ),
    DragOverlay: () => null,
  };
});
vi.mock("./BoardStages", () => ({ BoardStages: () => null }));
vi.mock("./BoardToolbar", () => ({ BoardToolbar: () => null }));
vi.mock("./DragDropZones", () => ({ DragDropZones: () => null, zoneTransition: () => null }));
vi.mock("./useBoardRealtime", () => ({ useBoardRealtime: () => {} }));
vi.mock("./useDealClose", () => ({ useDealClose: () => ({ close: vi.fn() }) }));
vi.mock("./useDealMove", () => ({
  BOARD_QUERY_KEY: (pipelineId: string) => ["board", pipelineId],
  useDealMove: () => ({ move: moveMock }),
}));
vi.mock("@/features/presence/ui/PresenceBar", () => ({ PresenceBar: () => null }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ client: { deal: { board: { query: vi.fn() } } } }),
    deal: { savedFilters: { useQuery: () => ({ data: [] }) } },
    identity: { assignableUsers: { useQuery: () => ({ data: [] }) } },
    labels: { listByTarget: { useQuery: () => ({ data: [] }) } },
  },
}));

import { Board } from "./Board";
import type { BoardData } from "./boardCache";
import { forgetBoardView } from "./boardViewMemory";
import { FIRST_DEAL_VERSION, SECOND_DEAL_VERSION } from "./dealClientFixture";

afterEach(() => {
  cleanup();
  forgetBoardView();
  vi.clearAllMocks();
});

it("emits board_drag_cancelled on drag cancel", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Board
        pipelineId="11111111-1111-1111-1111-111111111111"
        selfActorId="22222222-2222-2222-2222-222222222222"
        stages={[]}
        cards={[]}
        pipelines={[]}
        density="comfortable"
        serverNow={new Date("2026-06-01T00:00:00Z")}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel drag" }));
  expect(captureMock).toHaveBeenCalledWith("board_drag_cancelled", { route: "/pipeline/1" });
});

it("emits board_drag_started with the card's current stage", () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Board
        pipelineId="11111111-1111-1111-1111-111111111111"
        selfActorId="22222222-2222-2222-2222-222222222222"
        stages={[{ id: "stage-1", name: "Inbox", order: 0, rottingDays: null }]}
        cards={[{ ...baseCard, id: "d1", stageId: "stage-1" }]}
        pipelines={[]}
        density="comfortable"
        serverNow={new Date("2026-06-01T00:00:00Z")}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start drag" }));
  expect(captureMock).toHaveBeenCalledWith("board_drag_started", {
    route: "/pipeline/1",
    stageFrom: "stage-1",
  });
});

it("keeps the drag-start version when the board read refreshes during the gesture", () => {
  const pipelineId = "11111111-1111-1111-1111-111111111111";
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = { ...baseCard, id: "d1", stageId: "stage-1", writeVersion: FIRST_DEAL_VERSION };
  const refreshed = {
    ...first,
    title: "Changed remotely",
    stageId: "stage-2",
    writeVersion: SECOND_DEAL_VERSION,
  };
  const props = {
    pipelineId,
    selfActorId: "22222222-2222-2222-2222-222222222222",
    cards: [first],
    stages: [
      { id: "stage-1", name: "Inbox", order: 0, rottingDays: null },
      { id: "stage-2", name: "Review", order: 1, rottingDays: null },
    ],
    pipelines: [],
    density: "comfortable" as const,
    serverNow: new Date("2026-06-01T00:00:00Z"),
  };
  const { rerender } = render(
    <QueryClientProvider client={queryClient}>
      <Board {...props} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start drag" }));
  act(() => {
    queryClient.setQueryData<BoardData>(["board", pipelineId], (data) => ({
      ...data,
      cards: [refreshed],
    }));
  });
  rerender(
    <QueryClientProvider client={queryClient}>
      <Board {...props} cards={[refreshed]} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Finish drag" }));
  expect(moveMock).toHaveBeenCalledWith(
    expect.objectContaining({
      dealId: "d1",
      toStageId: "stage-2",
      expectedWriteVersion: FIRST_DEAL_VERSION,
    }),
  );
});
