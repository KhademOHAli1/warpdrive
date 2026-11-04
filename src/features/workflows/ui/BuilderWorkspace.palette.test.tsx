// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialBlankDefinition, initialDefinition } from "../editorModel";
import type { WorkflowDefinition } from "../schemas";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { readyPaletteRead } from "./palette.TestHelpers";
import type { PaletteRead } from "./paletteView";
import { useGraphHistory } from "./useGraphHistory";

vi.mock("./useWorkflowConfigurationReferences", () => ({
  useWorkflowConfigurationReferences: () => ({
    status: "ready",
    options: [],
    search: "",
    onSearch: vi.fn(),
    nextCursor: null,
    selected: undefined,
    unavailable: false,
    stale: false,
  }),
}));

vi.mock("./WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from picker journey</div>,
}));
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => ({
    metadata: { status: "complete", defs: [] },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: () => Promise.resolve(),
  }),
}));

afterEach(cleanup);
const workflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";

function branch(): WorkflowDefinition {
  const graph = initialBlankDefinition("Manual start");
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "gate",
        type: "condition",
        version: 1,
        name: "Review",
        config: {
          left: { kind: "reference", nodeId: "start", path: ["recordId"] },
          operator: "exists",
        },
      },
    ],
    edges: [{ from: "start", to: "gate", port: "next" }],
  };
}

function Workspace({
  initial,
  onCommit,
  read = readyPaletteRead(),
  editable = true,
}: {
  initial: WorkflowDefinition;
  onCommit: (definition: WorkflowDefinition) => void;
  read?: PaletteRead;
  editable?: boolean;
}) {
  const graph = useGraphHistory(initial);
  const change: Dispatch<SetStateAction<WorkflowDefinition>> = (next) => {
    const value = typeof next === "function" ? next(graph.definition) : next;
    onCommit(value);
    graph.setDefinition(value);
  };
  return (
    <BuilderWorkspace
      workflowId={workflowId}
      paletteRead={read}
      definition={graph.definition}
      onChange={change}
      editable={editable}
      issues={[]}
      history={graph}
    />
  );
}
function view(
  initial: WorkflowDefinition,
  onCommit: (definition: WorkflowDefinition) => void,
  read = readyPaletteRead(),
  editable = true,
) {
  return (
    <LocaleProvider locale="en">
      <Workspace initial={initial} onCommit={onCommit} read={read} editable={editable} />
    </LocaleProvider>
  );
}
function direct(
  definition: WorkflowDefinition,
  onChange: Dispatch<SetStateAction<WorkflowDefinition>>,
  read = readyPaletteRead(),
  editable = true,
) {
  return (
    <LocaleProvider locale="en">
      <BuilderWorkspace
        workflowId={workflowId}
        paletteRead={read}
        definition={definition}
        onChange={onChange}
        editable={editable}
        issues={[]}
      />
    </LocaleProvider>
  );
}
async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

// Written before the new picker production seam; these are future-API journey
// cases, distinct from the separately executed authentic current-API baseline.
it("adds one detached deal read and opens its actual mapping inspector", async () => {
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  render(view(initialBlankDefinition("Manual start"), onCommit));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add node" }));
  await choose(user, /^Read deal/);
  expect(onCommit).toHaveBeenCalledTimes(1);
  const added = onCommit.mock.calls[0]?.[0].nodes.find((node) => node.type === "record.read");
  expect(added).toBeDefined();
  expect(added?.config.recordId).toBeUndefined();
  expect(screen.getByRole("combobox", { name: "Deal to read" })).toBeVisible();
  expect(
    screen.getByText("Connect an earlier step to make its values available here."),
  ).toBeVisible();
  const name = screen.getByRole("textbox", { name: "Step name" });
  expect(name).toHaveValue("Read deal");
  await waitFor(() => expect(name).toHaveFocus());
});

it("adds a task on the selected true branch and opens the actual task fields", async () => {
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  render(view(branch(), onCommit));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Review/, pressed: false }));
  const connections = screen.getByRole("region", { name: "Connections" });
  const opener = within(connections).getAllByRole("button", {
    name: "Add a new connected step",
  })[0];
  if (opener === undefined) throw new Error("True-branch opener is missing");
  await user.click(opener);
  await choose(user, /^Create task/);
  const committed = onCommit.mock.calls[0]?.[0];
  const task = committed?.nodes.find((node) => node.type === "activity.create");
  expect(committed?.edges).toContainEqual({ from: "gate", to: task?.id, port: "true" });
  expect(task?.config.dealId).toEqual({ kind: "reference", nodeId: "start", path: ["recordId"] });
  expect(screen.getByRole("textbox", { name: "Step name" })).toHaveValue("Create task");
  expect(screen.getByText("Task title")).toBeVisible();
  expect(onCommit).toHaveBeenCalledTimes(1);
});

it("explains an occupied output restriction and splices one Wait without replacing old nodes", async () => {
  const graph = initialDefinition({
    start: "Manual start",
    read: "Read deal",
    task: "Create task",
    subject: "Follow up",
  });
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  render(view(graph, onCommit));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Insert a step here" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Condition", { exact: true })).toBeVisible();
  expect(within(dialog).getByText(/linear|branching/i)).toBeVisible();
  expect(within(dialog).getByRole("button", { name: /^Condition/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await choose(user, /^Wait/);
  const next = onCommit.mock.calls[0]?.[0];
  const wait = next?.nodes.find((node) => node.type === "delay");
  expect(next?.edges).toEqual(
    expect.arrayContaining([
      { from: "start", to: wait?.id, port: "next" },
      { from: wait?.id, to: "read", port: "next" },
    ]),
  );
  for (const old of graph.nodes) expect(next?.nodes.find((node) => node.id === old.id)).toBe(old);
  expect(onCommit).toHaveBeenCalledTimes(1);
});

it("configures the existing manual trigger without a new node or history edit", async () => {
  const graph = initialBlankDefinition("Manual start");
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  render(view(graph, onCommit));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add node" }));
  await choose(user, /^Manual trigger/);
  expect(screen.getByRole("textbox", { name: "Step name" })).toHaveValue("Manual start");
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(onCommit).not.toHaveBeenCalled();
  expect(graph.nodes).toHaveLength(1);
});

it("keeps an unavailable notification discoverable without closing or mutating", async () => {
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  render(view(initialBlankDefinition("Manual start"), onCommit));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add node" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Notification", { exact: true })).toBeVisible();
  expect(within(dialog).getAllByText(/not implemented/i).length).toBeGreaterThan(0);
  const unavailable = within(dialog).getByRole("button", { name: /^Notification/ });
  expect(unavailable).toHaveAttribute("aria-disabled", "true");
  await user.click(unavailable);
  expect(onCommit).not.toHaveBeenCalled();
  expect(dialog).toBeVisible();
});

it("honors a current negative edit decision while an authoring dialog is already open", async () => {
  const graph = initialBlankDefinition("Manual start");
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  const mounted = render(view(graph, onCommit));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add node" }));
  const read = readyPaletteRead({
    authoring: { allowed: false, reason: "workflow-edit-required" },
  });
  mounted.rerender(view(graph, onCommit, read));
  const button = within(screen.getByRole("dialog")).getByRole("button", { name: /^Read deal/ });
  expect(button).toHaveAttribute("aria-disabled", "true");
  await user.click(button);
  expect(onCommit).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeVisible();
});

it("rechecks a removed source rather than applying a stale connected insertion", async () => {
  const graph = initialBlankDefinition("Manual start");
  const onChange = vi.fn<Dispatch<SetStateAction<WorkflowDefinition>>>();
  const mounted = render(direct(graph, onChange));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add a new connected step" }));
  mounted.rerender(direct({ ...graph, nodes: [], edges: [] }, onChange));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: /^Read deal/ })).toHaveTextContent(
    "That node is no longer available.",
  );
  const candidate = within(dialog).queryByRole("button", { name: /^Read deal/ });
  if (candidate !== null) {
    expect(candidate).toHaveAttribute("aria-disabled", "true");
    await user.click(candidate);
  }
  expect(onChange).not.toHaveBeenCalled();
});

it("blocks a late node limit before closing the open insertion request", async () => {
  const graph = initialBlankDefinition("Manual start");
  const onChange = vi.fn<Dispatch<SetStateAction<WorkflowDefinition>>>();
  const mounted = render(direct(graph, onChange));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add node" }));
  const full: WorkflowDefinition = {
    ...graph,
    nodes: [
      ...graph.nodes,
      ...Array.from({ length: 99 }, (_, index) => ({
        id: `wait-${index}`,
        type: "delay" as const,
        version: 1 as const,
        name: "Wait",
        config: { minutes: { kind: "value", value: 1 } },
      })),
    ],
  };
  mounted.rerender(direct(full, onChange));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: /^Read deal/ })).toHaveTextContent(
    /100|limit/i,
  );
  const candidate = within(dialog).queryByRole("button", { name: /^Read deal/ });
  if (candidate !== null) {
    expect(candidate).toHaveAttribute("aria-disabled", "true");
    await user.click(candidate);
  }
  expect(onChange).not.toHaveBeenCalled();
  expect(dialog).toBeVisible();
});

it("restores the opener on cancel and a stable workspace fallback after edit revocation", async () => {
  const graph = initialBlankDefinition("Manual start");
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  const mounted = render(view(graph, onCommit));
  const user = userEvent.setup();
  const opener = screen.getByRole("button", { name: "Add a new connected step" });
  await user.click(opener);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(opener).toHaveFocus());
  await user.click(opener);
  mounted.rerender(view(graph, onCommit, readyPaletteRead(), false));
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.getByRole("region", { name: "Canvas controls" })).toHaveFocus(),
  );
  expect(onCommit).not.toHaveBeenCalled();
});

it("opens actual condition fields then undoes and redoes exactly that graph edit", async () => {
  const graph = initialBlankDefinition("Manual start");
  const onCommit = vi.fn<(value: WorkflowDefinition) => void>();
  render(view(graph, onCommit));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add a new connected step" }));
  await choose(user, /^Condition/);
  const condition = onCommit.mock.calls[0]?.[0].nodes.find((node) => node.type === "condition");
  expect(condition).toBeDefined();
  expect(screen.getByRole("textbox", { name: "Step name" })).toHaveValue("Condition");
  expect(screen.getByText("Comparison")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    screen.queryByRole("button", { name: /Condition/, pressed: true }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(screen.getByRole("textbox", { name: "Step name" })).toHaveValue("Condition");
  expect(onCommit).toHaveBeenCalledTimes(1);
});
