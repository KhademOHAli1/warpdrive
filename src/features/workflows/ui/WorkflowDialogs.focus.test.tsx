// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialBlankDefinition, initialDefinition } from "@/features/workflows/editorModel";
import type { WorkflowDefinition } from "@/features/workflows/schemas";
import { BuilderWorkspace } from "@/features/workflows/ui/BuilderWorkspace";
import { RunHistory } from "@/features/workflows/ui/RunHistory";
import type { WorkflowDetail } from "@/features/workflows/ui/useWorkflowEditor";
import { WorkflowEditor } from "@/features/workflows/ui/WorkflowEditor";
import { WorkflowLibrary } from "@/features/workflows/ui/WorkflowLibrary";

const queries = vi.hoisted(() => {
  const detail: unknown = undefined;
  return {
    rows: [] as unknown[],
    libraryRows: [] as unknown[],
    detail,
    cancel: vi.fn(),
    create: vi.fn(),
    push: vi.fn<(href: string) => void>(),
    run: vi.fn(),
  };
});

vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ workflows: { runs: { invalidate: vi.fn() } } }),
    workflows: {
      list: {
        useQuery: () => ({
          data: queries.libraryRows,
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        }),
      },
      runs: {
        useQuery: () => ({
          data: queries.rows,
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      run: {
        useQuery: () => ({
          data: queries.detail,
          isLoading: false,
          isError: false,
        }),
      },
    },
    search: {
      query: {
        useQuery: () => ({
          data: { deals: [] },
          isFetching: false,
          isError: false,
        }),
      },
    },
  },
}));
vi.mock("@/features/workflows/actions", () => ({
  cancelWorkflowAction: queries.cancel,
  createWorkflowAction: queries.create,
  runWorkflowAction: queries.run,
  saveWorkflowAction: vi.fn(),
  publishWorkflowAction: vi.fn(),
  pauseWorkflowAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: queries.push, refresh: vi.fn() }),
}));
vi.mock("@/features/workflows/ui/WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from focus regression</div>,
}));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/test",
}));

afterEach(() => {
  cleanup();
  queries.libraryRows = [];
  queries.cancel.mockClear();
  queries.create.mockReset();
  queries.push.mockReset();
  queries.run.mockClear();
});

function Workspace({ initial }: { initial: WorkflowDefinition }) {
  const [definition, setDefinition] = useState(initial);
  return <BuilderWorkspace definition={definition} onChange={setDefinition} editable issues={[]} />;
}

async function dismissAndExpectFocus(trigger: HTMLElement) {
  const user = userEvent.setup();
  trigger.focus();
  expect(trigger).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
    timeout: 1000,
    onTimeout: (error) => error,
  });
  await waitFor(
    () =>
      expect(
        document.activeElement === trigger,
        `Closing the dialog should restore focus to ${trigger.textContent?.trim()}; active element is ${document.activeElement?.tagName}`,
      ).toBe(true),
    { timeout: 1000, onTimeout: (error) => error },
  );
}

describe("workflow controlled-dialog keyboard focus return", () => {
  it("returns from creation to the originating New workflow control", async () => {
    render(
      <LocaleProvider locale="en">
        <WorkflowLibrary canCreate />
      </LocaleProvider>,
    );
    await dismissAndExpectFocus(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "New workflow",
      }),
    );
    expect(queries.create).not.toHaveBeenCalled();
  });

  it("returns to the header New workflow control when the empty-state opener disappears", async () => {
    const view = render(
      <LocaleProvider locale="en">
        <WorkflowLibrary canCreate />
      </LocaleProvider>,
    );
    const headerOpener = within(screen.getByRole("banner")).getByRole("button", {
      name: "New workflow",
    });
    const emptyOpener = screen
      .getAllByRole("button", { name: "New workflow" })
      .find((control) => control !== headerOpener);
    if (emptyOpener === undefined) throw new Error("Empty-state New workflow control missing");
    const user = userEvent.setup();
    emptyOpener.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toContainElement(
      document.activeElement as HTMLElement,
    );

    queries.libraryRows = [
      {
        id: "cb3defef-b67b-4502-b9a4-fb7ff761895a",
        name: "Another workflow",
        active: false,
        publishedNumber: null,
        updatedAt: new Date("2026-11-01T16:00:00Z"),
      },
    ];
    view.rerender(
      <LocaleProvider locale="en">
        <WorkflowLibrary canCreate />
      </LocaleProvider>,
    );
    expect(emptyOpener.isConnected).toBe(false);
    expect(headerOpener.isConnected).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
      timeout: 1000,
      onTimeout: (error) => error,
    });
    await waitFor(
      () =>
        expect(
          document.activeElement === headerOpener,
          `Closing creation after its empty-state opener disappears should focus header New workflow; active element is ${document.activeElement?.tagName}`,
        ).toBe(true),
      { timeout: 1000, onTimeout: (error) => error },
    );
    expect(queries.create).not.toHaveBeenCalled();
  });

  it.each(["Escape", "Cancel"] as const)(
    "returns to the originating New workflow control after successful creation before cold-route commit (%s)",
    async (dismissal) => {
      const createdId = "f8a12d86-3424-4a47-87db-24d65c024a27";
      const destination = `/workflows/${createdId}`;
      queries.create.mockResolvedValueOnce({ ok: true, value: { id: createdId } });
      // push records a void navigation request. It does not commit the route or unmount the library.
      const view = render(
        <LocaleProvider locale="en">
          <WorkflowLibrary canCreate />
        </LocaleProvider>,
      );
      const opener = within(screen.getByRole("banner")).getByRole("button", {
        name: "New workflow",
      });
      const user = userEvent.setup();
      opener.focus();
      await user.keyboard("{Enter}");
      const dialog = await screen.findByRole("dialog", { name: "New workflow" });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      const name = within(dialog).getByRole("textbox", { name: "Workflow name" });
      await user.clear(name);
      await user.type(name, "Cold-route focus workflow");
      await user.click(within(dialog).getByRole("button", { name: "Create workflow" }));
      await waitFor(
        () => {
          expect(queries.create).toHaveBeenCalledTimes(1);
          expect(queries.push).toHaveBeenCalledTimes(1);
          expect(queries.push).toHaveBeenCalledWith(destination);
          expect(dialog).toBeVisible();
          expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
          expect(within(dialog).getByRole("button", { name: "Create workflow" })).toBeEnabled();
          expect(name).toBeEnabled();
        },
        { timeout: 1000, onTimeout: (error) => error },
      );
      expect(queries.push.mock.results[0]?.value).toBeUndefined();
      expect(queries.create.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ name: "Cold-route focus workflow" }),
      );
      expect(opener.isConnected).toBe(true);
      if (dismissal === "Escape") await user.keyboard("{Escape}");
      else await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
        timeout: 1000,
        onTimeout: (error) => error,
      });
      expect(opener.isConnected).toBe(true);
      await waitFor(
        () =>
          expect(
            document.activeElement === opener,
            `Dismissing creation after success but before route commit should focus its connected origin; active element is ${document.activeElement?.tagName}`,
          ).toBe(true),
        { timeout: 1000, onTimeout: (error) => error },
      );
      // Dismissal closes the dialog; it does not retry or undo the completed create/navigation request.
      expect(queries.create).toHaveBeenCalledTimes(1);
      expect(queries.push).toHaveBeenCalledTimes(1);
      expect(queries.push).toHaveBeenCalledWith(destination);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      // Separate simulated route departure by the test, not evidence of actual Next navigation.
      view.rerender(
        <main>
          <h1>Created workflow route</h1>
        </main>,
      );
      expect(screen.getByRole("heading", { name: "Created workflow route" })).toBeInTheDocument();
      expect(opener.isConnected).toBe(false);
      expect(queries.create).toHaveBeenCalledTimes(1);
      expect(queries.push).toHaveBeenCalledTimes(1);
      expect(queries.push).toHaveBeenCalledWith(destination);
    },
  );

  it.each(["Simulate", "Run workflow"])(
    "returns from run setup to %s without starting an execution",
    async (label) => {
      const initial: WorkflowDetail = {
        id: "6ef69ee6-a029-476c-9f26-020fa475cdec",
        ownerId: "c5fdc435-a3f8-4108-84e9-5d5ced7e4d44",
        name: "Synthetic workflow",
        revision: 1,
        draft: initialDefinition({
          start: "Start",
          read: "Read",
          task: "Task",
          subject: "Call",
        }),
        active: true,
        publishedNumber: 1,
        archivedAt: null,
        createdAt: new Date("2026-10-31T12:00:00Z"),
        updatedAt: new Date("2026-10-31T12:00:00Z"),
        capabilities: { edit: true, publish: true, run: true, cancel: true },
      };
      render(
        <LocaleProvider locale="en">
          <WorkflowEditor initial={initial} />
        </LocaleProvider>,
      );
      await dismissAndExpectFocus(screen.getByRole("button", { name: label }));
      expect(queries.run).not.toHaveBeenCalled();
    },
  );

  it("returns from run details to the specific View run control", async () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const definition = initialDefinition({
      start: "Start",
      read: "Read",
      task: "Task",
      subject: "Call",
    });
    const runId = "8755a40e-fda9-4456-a3f4-7f6ff73a0eea";
    queries.rows = [
      {
        id: runId,
        status: "succeeded",
        mode: "simulation",
        versionId: "3a20c3a5-a2ed-4b18-8db6-8e57d54fcd68",
        errorId: null,
        createdAt: now,
        updatedAt: now,
        steps: [],
      },
    ];
    queries.detail = {
      id: runId,
      number: 1,
      status: "succeeded",
      mode: "simulation",
      errorId: null,
      nextNodeId: null,
      createdAt: now,
      updatedAt: now,
      definition,
      steps: [],
    };
    render(
      <LocaleProvider locale="en">
        <RunHistory workflowId="6ef69ee6-a029-476c-9f26-020fa475cdec" canCancel={false} />
      </LocaleProvider>,
    );
    await dismissAndExpectFocus(screen.getByRole("button", { name: "View run" }));
    expect(queries.cancel).not.toHaveBeenCalled();
  });

  it("returns from the node palette to Add node", async () => {
    render(
      <LocaleProvider locale="en">
        <Workspace initial={initialBlankDefinition("Start")} />
      </LocaleProvider>,
    );
    await dismissAndExpectFocus(screen.getByRole("button", { name: "Add node" }));
  });

  it("returns from the node palette to the connected-step configuration control", async () => {
    render(
      <LocaleProvider locale="en">
        <Workspace initial={initialBlankDefinition("Start")} />
      </LocaleProvider>,
    );
    await dismissAndExpectFocus(screen.getByRole("button", { name: "Add a new connected step" }));
  });

  it("focuses the new seventh step name after successful keyboard palette insertion", async () => {
    const definition = initialDefinition({
      start: "Starting point",
      read: "Review record",
      task: "First task",
      subject: "Call",
    });
    let previous = "task";
    for (let index = 1; index <= 3; index++) {
      const id = `existing_task_${index}`;
      definition.nodes.push({
        id,
        type: "activity.create",
        version: 1,
        name: `Existing task ${index}`,
        nameMode: "custom",
        config: { subject: { kind: "value", value: `Review ${index}` } },
      });
      definition.edges.push({ from: previous, to: id, port: "next" });
      previous = id;
    }
    render(
      <LocaleProvider locale="en">
        <Workspace initial={definition} />
      </LocaleProvider>,
    );
    const steps = screen.getByRole("navigation", { name: "Workflow steps" });
    expect(within(steps).getAllByRole("button")).toHaveLength(6);
    const user = userEvent.setup();
    screen.getByRole("button", { name: "Add node" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("textbox", { name: "Search steps" })).toHaveFocus();
    await user.keyboard("Create task");
    await user.tab();
    expect(screen.getByRole("button", { name: /Create task/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
      timeout: 1000,
      onTimeout: (error) => error,
    });
    expect(within(steps).getAllByRole("button")).toHaveLength(7);
    expect(
      within(steps).getByRole("button", { name: /Create task/, pressed: true }),
    ).toBeInTheDocument();
    const stepName = screen.getByRole("textbox", { name: "Step name" });
    expect(stepName).toHaveValue("Create task");
    await waitFor(
      () =>
        expect(
          document.activeElement === stepName,
          `Keyboard insertion should focus the new Step name textbox; active element is ${document.activeElement?.tagName}`,
        ).toBe(true),
      { timeout: 1000, onTimeout: (error) => error },
    );
  });
});
