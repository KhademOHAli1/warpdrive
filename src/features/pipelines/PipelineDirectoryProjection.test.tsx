// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PipelineDirectory, type PipelineDirectoryProps } from "./PipelineDirectory";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./CreatePipelineButton", () => ({
  CreatePipelineButton: () => <button type="button">Create pipeline</button>,
}));
afterEach(cleanup);
const initial = "2026-10-31T12:00:00.000Z";
const archived = "2026-10-31T12:01:00.000Z";
const restored = "2026-10-31T12:02:00.000Z";
const external = "2026-10-31T12:03:00.000Z";
const row = {
  id: "one",
  name: "Enterprise",
  isArchived: false,
  updatedAt: initial,
  stageCount: 2,
  dealCount: 1,
  visibility: "workspace" as const,
};

async function change(action: "Archive" | "Restore") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `${action}: Enterprise` }));
  await user.click(screen.getByRole("button", { name: `${action} pipeline` }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}
async function show(status: "Active" | "Archived") {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Pipeline status" }));
  await user.click(screen.getByRole("option", { name: `${status} pipelines` }));
}

function fixture(): PipelineDirectoryProps {
  return {
    rows: [row],
    enabled: true,
    canManage: true,
    snapshotId: "server-snapshot-1",
    onArchive: vi.fn().mockResolvedValue({ ok: true, value: { updatedAt: archived } }),
    onRestore: vi.fn().mockResolvedValue({ ok: true, value: { updatedAt: restored } }),
  };
}

it("carries each acknowledged revision through archive, restore and archive before server refresh", async () => {
  const props = fixture();
  render(<PipelineDirectory {...props} />);
  await change("Archive");
  await show("Archived");
  await change("Restore");
  await show("Active");
  await change("Archive");
  expect(props.onRestore).toHaveBeenCalledWith({ pipelineId: "one", expectedUpdatedAt: archived });
  expect(props.onArchive).toHaveBeenLastCalledWith({
    pipelineId: "one",
    expectedUpdatedAt: restored,
  });
});

it("keeps a newer acknowledged projection when an older server refresh arrives", async () => {
  const props = fixture();
  const { rerender } = render(<PipelineDirectory {...props} />);
  await change("Archive");
  await show("Archived");
  await change("Restore");
  await show("Active");
  rerender(
    <PipelineDirectory
      {...props}
      snapshotId="older-query-response"
      rows={[{ ...row, isArchived: true, updatedAt: archived }]}
    />,
  );
  expect(screen.getByRole("link", { name: "Enterprise" })).toBeVisible();
  rerender(
    <PipelineDirectory
      {...props}
      snapshotId="newer-query-response"
      rows={[{ ...row, isArchived: true, updatedAt: external }]}
    />,
  );
  expect(screen.queryByRole("link", { name: "Enterprise" })).not.toBeInTheDocument();
});

it("allows revalidation of a refused action only after a new server snapshot", async () => {
  const props = fixture();
  props.onArchive = vi.fn().mockResolvedValue({ ok: false, error: "last-active" });
  const { rerender } = render(<PipelineDirectory {...props} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Archive: Enterprise" }));
  await user.click(screen.getByRole("button", { name: "Archive pipeline" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
  rerender(<PipelineDirectory {...props} rows={[{ ...row }]} />);
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
  rerender(<PipelineDirectory {...props} snapshotId="server-snapshot-2" rows={[{ ...row }]} />);
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeEnabled();
});
