// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { PipelineLifecycleResult } from "./lifecycleTypes";
import german from "./messages/lifecycle.de.json";
import english from "./messages/lifecycle.en.json";
import persian from "./messages/lifecycle.fa.json";
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
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

const catalogs = { en: english, de: german, fa: persian };
const acknowledgedCases = (["en", "de", "fa"] as const).flatMap((locale) =>
  (["archive", "restore"] as const).map((action) => ({ locale, action })),
);

function deferred() {
  let resolve!: (result: PipelineLifecycleResult) => void;
  const promise = new Promise<PipelineLifecycleResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(acknowledgedCases)(
  "keeps $action acknowledged after refresh throws in $locale and uses its version for the next action",
  async ({ locale, action }) => {
    const L = catalogs[locale];
    const user = userEvent.setup();
    const firstWrite = deferred();
    const nextWrite = deferred();
    const first = vi.fn<PipelineDirectoryProps["onArchive"]>(() => firstWrite.promise);
    const opposite = vi.fn<PipelineDirectoryProps["onArchive"]>(() => nextWrite.promise);
    const onRefresh = vi.fn(() => {
      throw new Error("private refresh diagnostic");
    });
    const initialArchived = action === "restore";
    const firstName = (action === "archive" ? L.archiveNamed : L.restoreNamed).replace(
      "{name}",
      row.name,
    );
    const oppositeName = (action === "archive" ? L.restoreNamed : L.archiveNamed).replace(
      "{name}",
      row.name,
    );
    const onArchive = action === "archive" ? first : opposite;
    const onRestore = action === "restore" ? first : opposite;
    render(
      <LocaleProvider locale={locale}>
        <PipelineDirectory
          {...fixture(onArchive)}
          onRestore={onRestore}
          onRefresh={onRefresh}
          rows={[{ ...row, isArchived: initialArchived }]}
        />
      </LocaleProvider>,
    );
    await user.type(screen.getByRole("searchbox", { name: L.searchLabel }), "Enterprise");
    if (initialArchived) {
      await user.click(screen.getByRole("combobox", { name: L.statusLabel }));
      await user.click(screen.getByRole("option", { name: L.archived }));
    }
    await user.click(screen.getByRole("button", { name: firstName }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: action === "archive" ? L.confirmArchive : L.confirmRestore,
      }),
    );
    expect(screen.getByRole("button", { name: L.saving })).toBeDisabled();
    expect(screen.getByRole("button", { name: L.cancel })).toBeDisabled();
    expect(first).toHaveBeenCalledExactlyOnceWith({
      pipelineId: row.id,
      expectedUpdatedAt: row.updatedAt,
    });
    expect(opposite).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();

    const acknowledgedVersion = "2026-10-31T12:01:00.000Z";
    await act(async () => {
      firstWrite.resolve({ ok: true, value: { updatedAt: acknowledgedVersion } });
      await firstWrite.promise;
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      action === "archive" ? L.archiveSuccess : L.restoreSuccess,
    );
    expect(screen.getByRole("status")).toHaveTextContent(row.name);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("private refresh diagnostic")).not.toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: firstName })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: L.searchLabel })).toHaveValue("Enterprise");

    await user.click(screen.getByRole("combobox", { name: L.statusLabel }));
    await user.click(screen.getByRole("option", { name: initialArchived ? L.active : L.archived }));
    await user.click(screen.getByRole("button", { name: oppositeName }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(L.errorUnconfirmed);
    expect(dialog).toHaveTextContent(L.historyNote);
    const confirmOpposite = within(dialog).getByRole("button", {
      name: action === "archive" ? L.confirmRestore : L.confirmArchive,
    });
    expect(confirmOpposite).toBeEnabled();
    expect(opposite).not.toHaveBeenCalled();
    await user.click(confirmOpposite);
    expect(opposite).toHaveBeenCalledExactlyOnceWith({
      pipelineId: row.id,
      expectedUpdatedAt: acknowledgedVersion,
    });
    expect(screen.getByRole("button", { name: L.saving })).toBeDisabled();
    expect(screen.getByRole("button", { name: L.cancel })).toBeDisabled();
    expect(first).toHaveBeenCalledTimes(1);
    await act(async () => {
      nextWrite.resolve({ ok: true, value: { updatedAt: "2026-10-31T12:02:00.000Z" } });
      await nextWrite.promise;
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(
      action === "archive" ? L.restoreSuccess : L.archiveSuccess,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(opposite).toHaveBeenCalledTimes(1);
  },
);

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
  let rejectResponse: (error: Error) => void = () => undefined;
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
    await expect(response).rejects.toThrow("response lost after the earlier read");
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
