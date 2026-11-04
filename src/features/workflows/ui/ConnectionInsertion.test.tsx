// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Dispatch, type SetStateAction, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { validateDefinition } from "../definition";
import { initialBlankDefinition, initialDefinition } from "../editorModel";
import english from "../messages/workflows.en.json";
import { currentLayout, positionFor } from "../nodeLayout";
import type { WorkflowDefinition } from "../schemas";
import { BuilderWorkspace } from "./BuilderWorkspace";
import { paletteWorkflowId, readyPaletteRead } from "./palette.TestHelpers";

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
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => ({
    metadata: { status: "complete", defs: [] },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: () => Promise.resolve(),
  }),
}));

vi.mock("@/features/workflows/ui/WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from connection insertion regression</div>,
}));

afterEach(cleanup);

function sample(): WorkflowDefinition {
  const graph = initialDefinition({
    start: "Manual start",
    read: "Read deal",
    task: "Create task",
    subject: "Follow up",
  });
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === "task"
        ? {
            ...node,
            config: {
              ...node.config,
              subject: { kind: "reference", nodeId: "read", path: ["title"] },
            },
          }
        : node,
    ),
  };
}

function Workspace({
  initial,
  onCommit,
}: {
  initial: WorkflowDefinition;
  onCommit: (definition: WorkflowDefinition) => void;
}) {
  const [definition, setDefinition] = useState(initial);
  const change: Dispatch<SetStateAction<WorkflowDefinition>> = (next) => {
    const committed = typeof next === "function" ? next(definition) : next;
    onCommit(committed);
    setDefinition(committed);
  };
  return (
    <BuilderWorkspace
      workflowId={paletteWorkflowId}
      paletteRead={readyPaletteRead()}
      definition={definition}
      onChange={change}
      editable
      issues={[]}
    />
  );
}

function renderWorkspace(initial: WorkflowDefinition, locale: "en" | "fa" | "de" = "en") {
  const onCommit = vi.fn<(definition: WorkflowDefinition) => void>();
  render(
    <LocaleProvider locale={locale}>
      <Workspace initial={initial} onCommit={onCommit} />
    </LocaleProvider>,
  );
  return onCommit;
}

async function expectPaletteClosed() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), {
    timeout: 1000,
    onTimeout: (error) => error,
  });
}

it("opens an occupied output palette without committing and restores its opener on Escape", async () => {
  const initial = sample();
  const before = structuredClone(initial);
  const onCommit = renderWorkspace(initial);
  const user = userEvent.setup();
  const connections = screen.getByRole("region", { name: "Connections" });
  const opener = within(connections).getByRole("button", { name: "Insert a step here" });
  opener.focus();
  await user.keyboard("{Enter}");

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("textbox", { name: "Search steps" })).toHaveFocus();
  expect(within(dialog).getByRole("button", { name: /^Read deal/ })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: /^Create task/ })).toBeEnabled();
  expect(within(dialog).getByRole("button", { name: /^Wait/ })).toBeEnabled();
  const condition = within(dialog).getByRole("button", { name: /^Condition/ });
  expect(condition).toBeVisible();
  expect(condition).toHaveAttribute("aria-disabled", "true");
  expect(condition).toHaveTextContent(english.paletteLinearOnly);
  await user.click(condition);
  expect(dialog).toBeVisible();
  expect(onCommit).not.toHaveBeenCalled();
  expect(initial).toEqual(before);

  await user.keyboard("{Escape}");
  await expectPaletteClosed();
  await waitFor(() => expect(opener).toHaveFocus(), {
    timeout: 1000,
    onTimeout: (error) => error,
  });
  expect(onCommit).not.toHaveBeenCalled();
  expect(initial).toEqual(before);
});

it.each([
  {
    locale: "en",
    connections: "Connections",
    insert: "Insert a step here",
    search: "Search steps",
    wait: "Wait",
    steps: "Workflow steps",
    configure: "Configure",
    stepName: "Step name",
    duration: "Wait duration (minutes)",
  },
  {
    locale: "fa",
    connections: "اتصال‌ها",
    insert: "درج مرحله در اینجا",
    search: "جست‌وجوی گام‌ها",
    wait: "انتظار",
    steps: "مراحل گردش‌کار",
    configure: "تنظیمات",
    stepName: "نام مرحله",
    duration: "مدت انتظار (دقیقه)",
  },
  {
    locale: "de",
    connections: "Verbindungen",
    insert: "Schritt hier einfügen",
    search: "Schritte suchen",
    wait: "Warten",
    steps: "Workflow-Schritte",
    configure: "Konfiguration",
    stepName: "Schrittname",
    duration: "Wartezeit (Minuten)",
  },
] as const)(
  "commits one occupied-output Wait insertion and preserves bindings, positions and focus in $locale",
  async (copy) => {
    // No explicit layout: exercise the normal source/read fallback positions (0,0)/(0,260).
    const initial = sample();
    const before = structuredClone(initial);
    const onCommit = renderWorkspace(initial, copy.locale);
    const user = userEvent.setup();
    const connections = screen.getByRole("region", { name: copy.connections });
    within(connections).getByRole("button", { name: copy.insert }).focus();
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(onCommit).not.toHaveBeenCalled();
    const search = within(dialog).getByRole("textbox", { name: copy.search });
    await user.type(search, copy.wait);
    await user.tab();
    expect(within(dialog).getByRole("button", { name: new RegExp(`^${copy.wait}`) })).toHaveFocus();
    await user.keyboard("{Enter}");
    await expectPaletteClosed();

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.lastCall?.[0];
    if (committed === undefined) throw new Error("Wait insertion did not commit a graph");
    const wait = committed.nodes.find((node) => node.type === "delay");
    if (wait === undefined) throw new Error("Inserted Wait is missing");
    expect(wait).toMatchObject({
      version: 1,
      name: copy.wait,
      nameMode: "automatic",
      config: { minutes: { kind: "value", value: 1 } },
    });
    expect(committed.nodes).toHaveLength(4);
    for (const node of initial.nodes) {
      const retained = committed.nodes.find((item) => item.id === node.id);
      expect(retained).toBe(node);
      expect(retained?.config).toBe(node.config);
      expect(positionFor(committed, node.id)).toEqual(positionFor(initial, node.id));
    }
    expect(committed.layout).toMatchObject(currentLayout(initial));
    expect(positionFor(committed, wait.id)).not.toEqual(positionFor(initial, "read"));
    expect(committed.edges).toHaveLength(3);
    expect(committed.edges).toEqual(
      expect.arrayContaining([
        { from: "start", to: wait.id, port: "next" },
        { from: wait.id, to: "read", port: "next" },
        { from: "read", to: "task", port: "next" },
      ]),
    );
    expect(validateDefinition(committed).ok).toBe(true);
    expect(initial).toEqual(before);
    const steps = screen.getByRole("navigation", { name: copy.steps });
    expect(
      within(steps).getByRole("button", { name: new RegExp(copy.wait), pressed: true }),
    ).toBeInTheDocument();
    const inspector = screen.getByRole("region", { name: copy.configure });
    const stepName = within(inspector).getByRole("textbox", { name: copy.stepName });
    expect(stepName).toHaveValue(copy.wait);
    expect(within(inspector).getByLabelText(copy.duration)).toHaveValue("1");
    await waitFor(() => expect(stepName).toHaveFocus(), {
      timeout: 1000,
      onTimeout: (error) => error,
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
  },
);

it("keeps Condition available when adding to a free output", async () => {
  const initial = initialBlankDefinition("Manual start");
  const before = structuredClone(initial);
  const onCommit = renderWorkspace(initial);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add a new connected step" }));
  const dialog = await screen.findByRole("dialog");
  expect(onCommit).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: /^Condition/ }));
  await expectPaletteClosed();

  expect(onCommit).toHaveBeenCalledTimes(1);
  const committed = onCommit.mock.lastCall?.[0];
  if (committed === undefined) throw new Error("Free-output addition did not commit a graph");
  const condition = committed.nodes.find((node) => node.type === "condition");
  if (condition === undefined) throw new Error("The selected Condition is missing");
  expect(committed.nodes).toHaveLength(2);
  expect(committed.edges).toEqual([{ from: "start", to: condition.id, port: "next" }]);
  expect(committed.nodes.find((node) => node.id === "start")).toBe(initial.nodes[0]);
  expect(initial).toEqual(before);
});

it("keeps Condition available from the toolbar without replacing existing connections", async () => {
  const initial = sample();
  const before = structuredClone(initial);
  const onCommit = renderWorkspace(initial);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Add node" }));
  const dialog = await screen.findByRole("dialog");
  expect(onCommit).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: /^Condition/ }));
  await expectPaletteClosed();

  expect(onCommit).toHaveBeenCalledTimes(1);
  const committed = onCommit.mock.lastCall?.[0];
  if (committed === undefined) throw new Error("Toolbar addition did not commit a graph");
  expect(committed.nodes).toHaveLength(4);
  expect(committed.nodes.filter((node) => node.type === "condition")).toHaveLength(1);
  expect(committed.edges).toEqual(initial.edges);
  for (const node of initial.nodes) {
    expect(committed.nodes.find((item) => item.id === node.id)).toBe(node);
  }
  expect(initial).toEqual(before);
});

it("numbers the inserted Wait before its connected Read deal and Create task", async () => {
  const onCommit = renderWorkspace(sample());
  const user = userEvent.setup();
  const connections = screen.getByRole("region", { name: "Connections" });
  await user.click(within(connections).getByRole("button", { name: "Insert a step here" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: /^Wait/ }));
  await expectPaletteClosed();

  const steps = screen.getByRole("navigation", { name: "Workflow steps" });
  const buttons = within(steps).getAllByRole("button");
  expect(buttons.map((button) => button.getAttribute("title"))).toEqual([
    "Manual start",
    "Wait",
    "Read deal",
    "Create task",
  ]);
  for (const [index, button] of buttons.entries()) {
    expect(within(button).getByText(String(index + 1), { selector: "bdi" })).toBeVisible();
  }
  expect(onCommit).toHaveBeenCalledTimes(1);
});
