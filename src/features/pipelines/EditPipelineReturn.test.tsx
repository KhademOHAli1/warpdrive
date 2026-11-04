// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type RenameResult =
  | { ok: true; value: { id: string; name: string; updatedAt: string } }
  | { ok: false; error: { id: string } };
const { push, removeQueries, rename, create, update, remove, reorder } = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  removeQueries: vi.fn(),
  rename:
    vi.fn<
      (
        input: { pipelineId: string; name: string; expectedUpdatedAt: string },
        csrf: string | null,
      ) => Promise<RenameResult>
    >(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ removeQueries }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("./pipelineEditActions", () => ({
  renamePipelineAction: rename,
  createStageAction: create,
  updateStageAction: update,
  deleteStageAction: remove,
  reorderStagesAction: reorder,
}));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => children,
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: () => [],
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  horizontalListSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: vi.fn(),
}));
vi.mock("./SortableStageCard", () => ({ SortableStageCard: () => null }));

import { EditPipelineClient } from "./EditPipelineClient";

const PIPELINE_ID = "00000000-0000-4000-8000-000000000002";
const SETTINGS_TARGET = `/settings/company/pipelines#${encodeURIComponent(`pipeline-${PIPELINE_ID}`)}`;
const BOARD_TARGET = `/pipeline/${PIPELINE_ID}`;

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(cleanup);

function renderEditor(returnToSettings: boolean) {
  const props = {
    pipelineId: PIPELINE_ID,
    pipelineName: "Selected pipeline",
    pipelineUpdatedAt: "2026-10-31T12:00:00Z",
    snapshotId: "initial-read",
    stages: [
      {
        id: "stage-one",
        name: "Existing stage",
        rottingDays: null,
        dealCount: 3,
        closedDealCount: 1,
      },
    ],
    ...(returnToSettings ? { returnToSettings: true } : {}),
  };
  render(<EditPipelineClient {...props} />);
}

function acknowledgedRename(): RenameResult {
  return {
    ok: true,
    value: { id: PIPELINE_ID, name: "Renamed pipeline", updatedAt: "2026-10-31T12:01:00Z" },
  };
}

function expectNoStageWrites() {
  expect(create).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(reorder).not.toHaveBeenCalled();
}

it.each([
  { origin: "settings", settings: true, target: SETTINGS_TARGET },
  { origin: "board", settings: false, target: BOARD_TARGET },
])(
  "returns Cancel to the same pipeline context from $origin without writing",
  ({ settings, target }) => {
    renderEditor(settings);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(push).toHaveBeenCalledExactlyOnceWith(target);
    expect(rename).not.toHaveBeenCalled();
    expect(removeQueries).not.toHaveBeenCalled();
    expectNoStageWrites();
  },
);

it.each([
  { origin: "settings", settings: true, target: SETTINGS_TARGET },
  { origin: "board", settings: false, target: BOARD_TARGET },
])(
  "waits for Save acknowledgement before returning to the same context from $origin",
  async ({ settings, target }) => {
    let acknowledge!: (result: RenameResult) => void;
    const acknowledgement = new Promise<RenameResult>((resolve) => {
      acknowledge = resolve;
    });
    rename.mockReturnValueOnce(acknowledgement);
    renderEditor(settings);
    fireEvent.change(screen.getByRole("textbox", { name: "Pipeline name" }), {
      target: { value: "Renamed pipeline" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(rename).toHaveBeenCalledExactlyOnceWith(
      {
        pipelineId: PIPELINE_ID,
        name: "Renamed pipeline",
        expectedUpdatedAt: "2026-10-31T12:00:00Z",
      },
      "csrf",
    );
    await act(async () => {
      acknowledge(acknowledgedRename());
      await acknowledgement;
    });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledExactlyOnceWith(target);
    expect(removeQueries).toHaveBeenCalledTimes(1);
    expectNoStageWrites();
  },
);

it("retains the settings return context and authored name across a failed save and actual retry", async () => {
  rename
    .mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" } })
    .mockResolvedValueOnce(acknowledgedRename());
  renderEditor(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Pipeline name" }), {
    target: { value: "Renamed pipeline" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Pipeline name" })).toHaveValue("Renamed pipeline");
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(push).toHaveBeenCalledExactlyOnceWith(SETTINGS_TARGET);
  expect(rename).toHaveBeenCalledTimes(2);
  expect(rename.mock.calls[1]).toEqual(rename.mock.calls[0]);
  expectNoStageWrites();
});
