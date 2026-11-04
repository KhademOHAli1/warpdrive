// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, assert, beforeAll, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import type { CustomFieldDef } from "@/types/customFields";
import { removeNode } from "../graphEditor";
import copy from "../messages/workflows.en.json";
import type { DraftBinding, WorkflowDefinition, WorkflowNode } from "../schemas";
import { BindingField } from "./BindingField";
import { ConditionValue } from "./ConditionValue";
import {
  completeMappingMetadata,
  mappingGraph,
  mappingTarget,
  prepareMappingDom,
} from "./mapping.TestHelpers";
import { buildMappingPickerModel } from "./mappingView";
import { useGraphHistory } from "./useGraphHistory";
import { VariablePicker } from "./VariablePicker";
import { WorkflowCustomBinding } from "./WorkflowCustomBinding";

vi.mock("./useWorkflowConfigurationReferences", () => ({
  useWorkflowConfigurationReferences: () => ({
    status: "loading",
    options: [],
    search: "",
    onSearch: vi.fn(),
    nextCursor: null,
    loadingMore: false,
    onMore: vi.fn(),
    retry: () => Promise.resolve(),
    selected: undefined,
    unavailable: false,
    stale: false,
  }),
}));
beforeAll(prepareMappingDom);
afterEach(cleanup);
const selected = { kind: "reference" as const, nodeId: "read", path: ["title"] };
function binding(graph: WorkflowDefinition, changed: (value: DraftBinding) => void) {
  return (
    <BindingField
      definition={graph}
      nodeId="task"
      value={selected}
      onChange={changed}
      kind="text"
      label={copy.subjectLabel}
      sourceLabel={copy.subjectSource}
      editable
      metadata={completeMappingMetadata}
    />
  );
}
function conditionFixture() {
  const graph = mappingGraph();
  const node: WorkflowNode = {
    id: "compare",
    type: "condition",
    version: 1,
    name: "Compare",
    config: {
      left: { kind: "reference", nodeId: "read", path: ["title"] },
      operator: "equals",
      right: { kind: "value", value: 0 },
    },
  };
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    edges: [...graph.edges, { from: "task", to: "compare", port: "next" as const }],
  };
}

it("retains the selected reference and reports a removed predecessor without automatic rebinding", async () => {
  const graph = mappingGraph();
  const changed = vi.fn();
  const mounted = render(<fieldset>{binding(graph, changed)}</fieldset>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: copy.mappingChooseSource }));
  const removed = removeNode(graph, "read");
  mounted.rerender(<fieldset disabled>{binding(removed, changed)}</fieldset>);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.getByRole("region", { name: copy.mappingPreviewTitle })).toHaveFocus(),
  );
  expect(screen.getByRole("group", { name: copy.mappingChipLabel })).toHaveTextContent(
    copy.unavailableValue,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(copy.mappingInvalid);
  expect(removed.nodes.find((node) => node.id === "task")?.config.subject).toEqual(
    graph.nodes.find((node) => node.id === "task")?.config.subject,
  );
  expect(changed).not.toHaveBeenCalled();
});
it("closes the picker and restores focus without recording the current reference with reordered JSON keys", async () => {
  const graph = mappingGraph();
  const changed = vi.fn();
  const value = { path: ["title"], kind: "reference", nodeId: "read" };
  render(
    <BindingField
      definition={graph}
      nodeId="task"
      value={value}
      onChange={changed}
      kind="text"
      label={copy.subjectLabel}
      sourceLabel={copy.subjectSource}
      editable
      metadata={completeMappingMetadata}
    />,
  );
  const user = userEvent.setup();
  const opener = screen.getByRole("button", { name: copy.mappingChooseSource });
  await user.click(opener);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: new RegExp(copy.fields.title) }),
  );
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  expect(value).toEqual({ kind: "reference", nodeId: "read", path: ["title"] });
});
it("updates renamed source labels while retaining stable keys and graph history", () => {
  const graph = mappingGraph();
  const changed = vi.fn();
  const mounted = render(binding(graph, changed));
  const renamed = {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === "read" ? { ...node, name: "Renamed <safe> source" } : node,
    ),
  };
  mounted.rerender(binding(renamed, changed));
  expect(screen.getByRole("group", { name: copy.mappingChipLabel })).toHaveTextContent(
    "Renamed <safe> source",
  );
  expect(selected).toEqual({ kind: "reference", nodeId: "read", path: ["title"] });
  expect(changed).not.toHaveBeenCalled();
});
it("edits inherited numeric zero as a native number through the actual ConditionValue adapter", () => {
  const definition = conditionFixture();
  const node = definition.nodes.find((item) => item.id === "compare");
  assert(node !== undefined);
  const changed = vi.fn();
  render(
    <ConditionValue
      definition={definition}
      node={node}
      editable
      boolean={false}
      status={false}
      onChange={changed}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: copy.conditionValue }), {
    target: { value: "1" },
  });
  expect(changed).toHaveBeenCalledExactlyOnceWith({ kind: "value", value: 1 });
  expect(node.config.right).toEqual({ kind: "value", value: 0 });
});

function HistoryJourney({ saved }: { saved: (definition: WorkflowDefinition) => void }) {
  const history = useGraphHistory(conditionFixture());
  const [snapshot, setSnapshot] = useState<WorkflowDefinition | null>(null);
  const node = history.definition.nodes.find((item) => item.id === "compare");
  assert(node !== undefined);
  return (
    <>
      <ConditionValue
        definition={history.definition}
        node={node}
        editable
        boolean={false}
        status={false}
        onChange={(right) =>
          history.setDefinition((graph) => ({
            ...graph,
            nodes: graph.nodes.map((item) =>
              item.id === node.id ? { ...item, config: { ...item.config, right } } : item,
            ),
          }))
        }
      />
      <Button
        onClick={() => {
          saved(history.definition);
          setSnapshot(structuredClone(history.definition));
        }}
      >
        Save draft
      </Button>
      <Button
        onClick={() => {
          if (snapshot !== null) history.reset(snapshot);
        }}
      >
        Reload
      </Button>
      <Button onClick={history.undo}>Undo</Button>
      <Button onClick={history.redo}>Redo</Button>
    </>
  );
}
it("keeps numeric raw intent through save/reload and real graph undo/redo", async () => {
  const saved = vi.fn<(definition: WorkflowDefinition) => void>();
  render(<HistoryJourney saved={saved} />);
  fireEvent.change(screen.getByRole("textbox", { name: copy.conditionValue }), {
    target: { value: "-" },
  });
  fireEvent.blur(screen.getByRole("textbox", { name: copy.conditionValue }));
  await userEvent.setup().click(screen.getByRole("button", { name: "Save draft" }));
  expect(
    saved.mock.calls.at(-1)?.[0].nodes.find((node) => node.id === "compare")?.config.right,
  ).toEqual({ kind: "value", value: "-", literalType: "number" });
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(screen.getByRole("textbox", { name: copy.conditionValue })).toHaveValue("-");
  fireEvent.change(screen.getByRole("textbox", { name: copy.conditionValue }), {
    target: { value: "1." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("textbox", { name: copy.conditionValue })).toHaveValue("-");
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(screen.getByRole("textbox", { name: copy.conditionValue })).toHaveValue("1.");
});
it("maps an actual owner identity into a custom user field without persisting a preview example", async () => {
  const definition = mappingGraph();
  const node = definition.nodes.find((item) => item.id === "task");
  assert(node !== undefined);
  const def: CustomFieldDef = {
    id: "e96b131c-a58c-4469-84b1-81e249e653bc",
    targetEntity: "activity",
    type: "user",
    name: "Reviewer",
    key: "reviewer",
    options: [],
    isRequired: false,
    isImportant: false,
    showInAddForm: false,
    order: 0,
    archivedAt: null,
  };
  const changed = vi.fn();
  render(
    <WorkflowCustomBinding
      definition={definition}
      node={node}
      def={def}
      metadata={{ status: "complete", defs: [def] }}
      editable
      onChange={changed}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: copy.mappingChooseSource }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: new RegExp(copy.fields.ownerId),
    }),
  );
  expect(changed).toHaveBeenCalledExactlyOnceWith({
    ...node,
    config: {
      ...node.config,
      customFields: { [def.id]: { kind: "reference", nodeId: "read", path: ["ownerId"] } },
    },
  });
  expect(node.config.customFields).toBeUndefined();
});
it("hides source labels on confirmed denial and performs no preview fetch", () => {
  const graph = mappingGraph();
  const chosen = vi.fn();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected preview request"));
  try {
    const model = buildMappingPickerModel(
      graph,
      "task",
      mappingTarget(graph),
      selected,
      { status: "denied" },
      true,
    );
    render(<VariablePicker open model={model} onChoose={chosen} onClose={vi.fn()} />);
    expect(screen.getByText(copy.mappingDenied)).toBeInTheDocument();
    expect(screen.queryByText("Opportunity read")).not.toBeInTheDocument();
    expect(chosen).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
