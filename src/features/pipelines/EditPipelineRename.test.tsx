// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type * as DndCore from "@dnd-kit/core";
import type * as DndSortable from "@dnd-kit/sortable";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
const renamePipelineAction = vi.fn();
const createStageAction = vi.fn();
const updateStageAction = vi.fn();
vi.mock("./pipelineEditActions", () => ({
  renamePipelineAction: (...args: unknown[]) => renamePipelineAction(...args),
  createStageAction: (...args: unknown[]) => createStageAction(...args),
  updateStageAction: (...args: unknown[]) => updateStageAction(...args),
  deleteStageAction: vi.fn(),
  reorderStagesAction: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf-token" }));
vi.mock("@dnd-kit/core", async (load) => ({
  ...(await load<typeof DndCore>()),
  DndContext: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@dnd-kit/sortable", async (load) => ({
  ...(await load<typeof DndSortable>()),
  SortableContext: ({ children }: { children: React.ReactNode }) => children,
  useSortable: () => ({
    attributes: {},
    listeners: undefined,
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

import { EditPipelineClient } from "./EditPipelineClient";

const V1 = "2026-10-31T14:00:00.001Z";
const V2 = "2026-10-31T14:00:00.002Z";
const V3 = "2026-10-31T14:00:00.003Z";
const STAGES = [{ id: "s1", name: "Lead", rottingDays: null, dealCount: 0, closedDealCount: 0 }];
const queryClient = new QueryClient();
function editor(updatedAt = V1, snapshotId = "read-1", pipelineName = "Sales") {
  return (
    <QueryClientProvider client={queryClient}>
      <EditPipelineClient
        pipelineId="p1"
        pipelineName={pipelineName}
        pipelineUpdatedAt={updatedAt}
        snapshotId={snapshotId}
        stages={STAGES}
      />
    </QueryClientProvider>
  );
}
function changeName(value = "فروش / Vertrieb") {
  fireEvent.change(screen.getByLabelText("Pipeline name"), { target: { value } });
}
function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
}
beforeEach(() => {
  renamePipelineAction.mockResolvedValue({
    ok: true,
    value: { id: "p1", name: "فروش / Vertrieb", updatedAt: V2 },
  });
  createStageAction.mockResolvedValue({ ok: true, value: { id: "new-stage" } });
  updateStageAction.mockResolvedValue({ ok: true, value: { id: "s1" } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  queryClient.clear();
});

test("rename sends the authoritative source revision and retains mixed authored text", async () => {
  render(editor());
  changeName();
  save();
  await waitFor(() => expect(push).toHaveBeenCalledWith("/pipeline/p1"));
  expect(renamePipelineAction).toHaveBeenCalledWith(
    { pipelineId: "p1", name: "فروش / Vertrieb", expectedUpdatedAt: V1 },
    "csrf-token",
  );
});

test("acknowledged rename is not resubmitted after a later stage failure", async () => {
  updateStageAction.mockResolvedValueOnce({ ok: false, error: { id: "E_STAGE_001" } });
  render(editor());
  changeName();
  fireEvent.change(screen.getByLabelText("Stage 1 name"), { target: { value: "Changed stage" } });
  save();
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  save();
  await waitFor(() => expect(push).toHaveBeenCalledWith("/pipeline/p1"));
  expect(renamePipelineAction).toHaveBeenCalledTimes(1);
});

test("a newly edited name after partial save uses the acknowledged revision", async () => {
  updateStageAction.mockResolvedValueOnce({ ok: false, error: { id: "E_STAGE_001" } });
  render(editor());
  changeName();
  fireEvent.change(screen.getByLabelText("Stage 1 name"), { target: { value: "Changed stage" } });
  save();
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  changeName("نام بعدی / Neuer Name");
  save();
  await waitFor(() => expect(push).toHaveBeenCalledWith("/pipeline/p1"));
  expect(renamePipelineAction).toHaveBeenLastCalledWith(
    { pipelineId: "p1", name: "نام بعدی / Neuer Name", expectedUpdatedAt: V2 },
    "csrf-token",
  );
});

test("conflict requires a refreshed version and explicit review while preserving the draft", async () => {
  renamePipelineAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PIPELINE_002" } });
  const view = render(editor());
  changeName();
  save();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/changed/i));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByLabelText("Pipeline name")).toHaveValue("فروش / Vertrieb");
  fireEvent.click(screen.getByRole("button", { name: "Refresh saved version" }));
  expect(refresh).toHaveBeenCalledOnce();
  view.rerender(editor(V3, "read-2", "نام همکار / Kollegin"));
  expect(screen.getByLabelText("Pipeline name")).toHaveValue("فروش / Vertrieb");
  expect(screen.getByText("نام همکار / Kollegin")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep my draft and use this version" }));
  save();
  await waitFor(() => expect(push).toHaveBeenCalled());
  expect(renamePipelineAction).toHaveBeenLastCalledWith(
    { pipelineId: "p1", name: "فروش / Vertrieb", expectedUpdatedAt: V3 },
    "csrf-token",
  );
});

test("fresh-proof recovery opens native account security and retains the pending rename", async () => {
  renamePipelineAction.mockResolvedValueOnce({ ok: false, error: { id: "E_PIPELINE_003" } });
  render(editor());
  changeName();
  save();
  await waitFor(() =>
    expect(screen.getByRole("link", { name: /Verify identity/ })).toHaveAttribute(
      "href",
      "/settings/security",
    ),
  );
  expect(screen.getByRole("link", { name: /Verify identity/ })).toHaveAttribute("target", "_blank");
  expect(screen.getByLabelText("Pipeline name")).toHaveValue("فروش / Vertrieb");
  expect(updateStageAction).not.toHaveBeenCalled();
  save();
  await waitFor(() => expect(push).toHaveBeenCalled());
});

test("an unknown rename response blocks retry until a fresh server read is reviewed", async () => {
  renamePipelineAction.mockRejectedValueOnce(new Error("lost response"));
  const view = render(editor());
  changeName();
  save();
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be confirmed/i),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  view.rerender(editor(V1, "read-1"));
  expect(
    screen.queryByRole("button", { name: "Keep my draft and use this version" }),
  ).not.toBeInTheDocument();
  view.rerender(editor(V1, "read-2"));
  fireEvent.click(screen.getByRole("button", { name: "Keep my draft and use this version" }));
  save();
  await waitFor(() => expect(push).toHaveBeenCalled());
  expect(renamePipelineAction).toHaveBeenCalledTimes(2);
});

test("whitespace-only rename keeps the editor open without applying stage mutations", async () => {
  render(editor());
  changeName("   ");
  save();
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/name/i));
  expect(renamePipelineAction).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test("an unchanged legacy whitespace name does not block a stage-only save", async () => {
  render(editor(V1, "read-1", "   "));
  fireEvent.change(screen.getByLabelText("Stage 1 name"), { target: { value: "Changed stage" } });
  save();
  await waitFor(() => expect(push).toHaveBeenCalledWith("/pipeline/p1"));
  expect(renamePipelineAction).not.toHaveBeenCalled();
  expect(updateStageAction).toHaveBeenCalledWith(
    { stageId: "s1", name: "Changed stage", rottingDays: null },
    "csrf-token",
  );
});
