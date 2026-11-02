// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { PipelineDirectory, type PipelineDirectoryProps } from "./PipelineDirectory";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("./CreatePipelineButton", () => ({
  CreatePipelineButton: () => <button type="button">Create pipeline</button>,
}));

const firstTimestamp = "2026-10-31T12:00:00.000Z";
const nextTimestamp = "2026-10-31T12:01:00.000Z";

function fixture() {
  const onArchive = vi.fn(() =>
    Promise.resolve({ ok: true as const, value: { updatedAt: nextTimestamp } }),
  );
  const onRestore = vi.fn(() =>
    Promise.resolve({ ok: true as const, value: { updatedAt: nextTimestamp } }),
  );
  const onRefresh = vi.fn();
  const props: PipelineDirectoryProps = {
    enabled: true,
    canManage: true,
    onArchive,
    onRestore,
    onRefresh,
    rows: [
      {
        id: "one",
        name: "Enterprise <علی>",
        isArchived: false,
        updatedAt: firstTimestamp,
        stageCount: 4,
        dealCount: 3,
        visibility: "workspace",
      },
      {
        id: "two",
        name: "Restricted team",
        isArchived: false,
        updatedAt: firstTimestamp,
        stageCount: 2,
        dealCount: 1,
        visibility: "restricted",
      },
      {
        id: "three",
        name: "Legacy process",
        isArchived: true,
        updatedAt: firstTimestamp,
        stageCount: 3,
        dealCount: 0,
        visibility: "restricted",
      },
    ],
  };
  return { props, onArchive, onRestore, onRefresh };
}

afterEach(cleanup);

describe("pipeline lifecycle directory", () => {
  it("preserves current record routes and distinguishes visible counts from total access", () => {
    const { props } = fixture();
    render(<PipelineDirectory {...props} />);
    expect(screen.getByRole("link", { name: "Enterprise <علی>" })).toHaveAttribute(
      "href",
      "/pipeline/one",
    );
    expect(screen.getByText("3 visible opportunities")).toBeVisible();
    expect(screen.getByText("Restricted by visibility group")).toBeVisible();
    expect(screen.getByText(/Existing permissions still control access/)).toBeVisible();
    expect(screen.queryByText("Legacy process")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Edit stages" })).toHaveLength(2);
  });

  it("shows no lifecycle surface when the server feature gate is disabled", () => {
    const { props } = fixture();
    const { container } = render(<PipelineDirectory {...props} enabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps non-managers out of management controls", () => {
    const { props } = fixture();
    render(<PipelineDirectory {...props} canManage={false} />);
    expect(screen.queryByRole("button", { name: /Archive:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit stages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create pipeline" })).not.toBeInTheDocument();
  });

  it("distinguishes a new directory from a search with no results", async () => {
    const f = fixture();
    const { rerender } = render(<PipelineDirectory {...f.props} rows={[]} />);
    expect(screen.getByText("No active pipelines yet.")).toBeVisible();
    rerender(<PipelineDirectory {...f.props} />);
    await userEvent
      .setup()
      .type(screen.getByRole("searchbox", { name: "Search pipelines" }), "missing");
    expect(screen.getByText("No pipelines match this search.")).toBeVisible();
    expect(screen.queryByText("No active pipelines yet.")).not.toBeInTheDocument();
  });

  it("requires explicit archive confirmation and explains retained history and hidden opportunities", async () => {
    const f = fixture();
    render(<PipelineDirectory {...f.props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Archive: Enterprise <علی>" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("3 visible opportunities");
    expect(dialog).toHaveTextContent("including opportunities you cannot see");
    expect(dialog).toHaveTextContent("Records and history are retained");
    expect(f.onArchive).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Archive pipeline" }));
    await waitFor(() =>
      expect(f.onArchive).toHaveBeenCalledWith({
        pipelineId: "one",
        expectedUpdatedAt: firstTimestamp,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("Pipeline archived");
    expect(screen.queryByRole("link", { name: "Enterprise <علی>" })).not.toBeInTheDocument();
  });

  it("offers restore from the archived list and never offers delete", async () => {
    const f = fixture();
    render(<PipelineDirectory {...f.props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Pipeline status" }));
    await user.click(screen.getByRole("option", { name: "Archived pipelines" }));
    expect(screen.getByText("Legacy process")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Edit stages" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete|purge/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore: Legacy process" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Restore pipeline" }),
    );
    await waitFor(() =>
      expect(f.onRestore).toHaveBeenCalledWith({
        pipelineId: "three",
        expectedUpdatedAt: firstTimestamp,
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Pipeline restored");
  });

  it("retains search and the confirmation after failure, then retries the same intended action", async () => {
    const f = fixture();
    const archive: PipelineDirectoryProps["onArchive"] = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "failed" })
      .mockResolvedValueOnce({ ok: true, value: { updatedAt: nextTimestamp } });
    render(<PipelineDirectory {...f.props} onArchive={archive} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "Enterprise");
    await user.click(screen.getByRole("button", { name: "Archive: Enterprise <علی>" }));
    await user.click(screen.getByRole("button", { name: "Archive pipeline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(screen.getByRole("searchbox", { hidden: true })).toHaveValue("Enterprise");
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Archive pipeline" }));
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("blocks a stale retry until refreshed server data supplies a current revision", async () => {
    const f = fixture();
    const archive: PipelineDirectoryProps["onArchive"] = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "conflict" })
      .mockResolvedValueOnce({ ok: true, value: { updatedAt: "2026-10-31T12:02:00.000Z" } });
    const { rerender } = render(<PipelineDirectory {...f.props} onArchive={archive} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "Enterprise");
    await user.click(screen.getByRole("button", { name: "Archive: Enterprise <علی>" }));
    await user.click(screen.getByRole("button", { name: "Archive pipeline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed");
    expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Refresh list" }));
    expect(f.onRefresh).toHaveBeenCalledOnce();
    rerender(
      <PipelineDirectory
        {...f.props}
        onArchive={archive}
        rows={f.props.rows.map((row) =>
          row.id === "one" ? { ...row, updatedAt: nextTimestamp } : row,
        )}
      />,
    );
    expect(screen.getByRole("searchbox", { hidden: true })).toHaveValue("Enterprise");
    expect(screen.getByRole("button", { name: "Archive pipeline" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Archive pipeline" }));
    await waitFor(() =>
      expect(archive).toHaveBeenLastCalledWith({
        pipelineId: "one",
        expectedUpdatedAt: nextTimestamp,
      }),
    );
  });

  it("holds an in-flight mutation and prevents repeated submission", async () => {
    const f = fixture();
    let finish: (result: Awaited<ReturnType<PipelineDirectoryProps["onArchive"]>>) => void = () =>
      undefined;
    const archive: PipelineDirectoryProps["onArchive"] = vi.fn(
      () =>
        new Promise<Awaited<ReturnType<PipelineDirectoryProps["onArchive"]>>>((resolve) => {
          finish = resolve;
        }),
    );
    render(<PipelineDirectory {...f.props} onArchive={archive} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Archive: Enterprise <علی>" }));
    await user.click(screen.getByRole("button", { name: "Archive pipeline" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(archive).toHaveBeenCalledOnce();
    finish({ ok: true, value: { updatedAt: nextTimestamp } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it.each(["fa", "de"] as const)(
    "uses %s contextual copy and isolates raw mixed-direction names",
    (locale) => {
      const f = fixture();
      const { container } = render(
        <LocaleProvider locale={locale}>
          <PipelineDirectory {...f.props} />
        </LocaleProvider>,
      );
      const name = screen.getByRole("link", { name: "Enterprise <علی>" });
      expect(name.querySelector("bdi")).toHaveAttribute("dir", "auto");
      expect(name).toHaveTextContent("Enterprise <علی>");
      expect(container.querySelector("[data-pipeline-directory]")).toHaveAttribute(
        "dir",
        locale === "fa" ? "rtl" : "ltr",
      );
      expect(screen.getByRole("searchbox")).toHaveAccessibleName(
        locale === "fa" ? "جست‌وجوی مسیرهای فروش" : "Vertriebspipelines suchen",
      );
    },
  );
});
