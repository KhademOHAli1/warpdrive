// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PipelineLifecycleResult } from "./lifecycleTypes";
import { PipelineDirectory, type PipelineDirectoryProps } from "./PipelineDirectory";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./CreatePipelineButton", () => ({
  CreatePipelineButton: () => <button type="button">Create pipeline</button>,
}));

const row = {
  id: "one",
  name: "Enterprise علی",
  isArchived: false,
  updatedAt: "2026-10-31T12:00:00.000Z",
  stageCount: 4,
  dealCount: 3,
  visibility: "workspace" as const,
};
function fixture(onArchive: PipelineDirectoryProps["onArchive"]): PipelineDirectoryProps {
  return {
    enabled: true,
    snapshotId: "server-snapshot-1",
    canManage: true,
    rows: [row],
    onArchive,
    onRestore: vi.fn(),
    onRefresh: vi.fn(),
  };
}
async function confirm() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Archive: Enterprise علی" }));
  await user.click(screen.getByRole("button", { name: "Archive pipeline" }));
}
afterEach(cleanup);

it.each([
  { error: "denied", text: "no longer manage" },
  { error: "unavailable", text: "not enabled" },
  { error: "last-active", text: "At least one pipeline" },
  { error: "default-pipeline", text: "default pipeline" },
] as const)("keeps the $error refusal explicit and records no success", async ({ error, text }) => {
  const archive: PipelineDirectoryProps["onArchive"] = vi
    .fn()
    .mockResolvedValue({ ok: false, error });
  render(<PipelineDirectory {...fixture(archive)} />);
  await confirm();
  expect(await screen.findByRole("alert")).toHaveTextContent(text);
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(archive).toHaveBeenCalledOnce();
});

it("keeps the current selection while offering native fresh verification in a separate tab", async () => {
  const archive: PipelineDirectoryProps["onArchive"] = vi
    .fn()
    .mockResolvedValue({ ok: false, error: "fresh-auth-required" });
  render(<PipelineDirectory {...fixture(archive)} />);
  await userEvent.setup().type(screen.getByRole("searchbox"), "Enterprise");
  await confirm();
  const link = await screen.findByRole("link", {
    name: "Verify identity in account security (new tab)",
  });
  expect(link).toHaveAttribute("href", "/settings/security");
  expect(link).toHaveAttribute("target", "_blank");
  expect(screen.getByRole("searchbox", { hidden: true })).toHaveValue("Enterprise");
  expect(screen.getByRole("dialog")).toHaveTextContent("Enterprise علی");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("does not retry an unconfirmed response until refreshed server data arrives", async () => {
  const archive: PipelineDirectoryProps["onArchive"] = vi
    .fn()
    .mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValueOnce({ ok: true, value: { updatedAt: "2026-10-31T12:01:00.000Z" } });
  const props = fixture(archive);
  const { rerender } = render(<PipelineDirectory {...props} />);
  await confirm();
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Refresh list" }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(archive).toHaveBeenCalledOnce();
  rerender(<PipelineDirectory {...props} rows={[{ ...row }]} />);
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
  rerender(<PipelineDirectory {...props} snapshotId="server-snapshot-2" rows={[{ ...row }]} />);
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeEnabled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Archive pipeline" }));
  await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
});

it("returns keyboard focus to the same action after cancellation", async () => {
  const archive: PipelineDirectoryProps["onArchive"] = vi.fn();
  render(<PipelineDirectory {...fixture(archive)} />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Archive: Enterprise علی" });
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(archive).not.toHaveBeenCalled();
});

it("retains an unconfirmed hold when the same action is reopened before refresh", async () => {
  const archive: PipelineDirectoryProps["onArchive"] = vi
    .fn()
    .mockRejectedValue(new Error("connection lost"));
  render(<PipelineDirectory {...fixture(archive)} />);
  await confirm();
  await screen.findByRole("alert");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Archive: Enterprise علی" }));
  expect(screen.getByRole("alert")).toHaveTextContent("could not be confirmed");
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
  expect(archive).toHaveBeenCalledOnce();
});

it("does not use a snapshot received while pending to release a later unknown outcome", async () => {
  let rejectResponse = (_error: Error): void => undefined;
  const response = new Promise<PipelineLifecycleResult>((_resolve, reject) => {
    rejectResponse = reject;
  });
  const archive = vi.fn(() => response);
  const props = fixture(archive);
  const { rerender } = render(<PipelineDirectory {...props} />);
  await confirm();
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();

  rerender(<PipelineDirectory {...props} snapshotId="read-during-write" rows={[{ ...row }]} />);
  await act(async () => {
    rejectResponse(new Error("response lost after the earlier read"));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();

  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Archive: Enterprise علی" }));
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
  rerender(<PipelineDirectory {...props} snapshotId="read-after-outcome" rows={[{ ...row }]} />);
  expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeEnabled();
  expect(archive).toHaveBeenCalledOnce();
});
