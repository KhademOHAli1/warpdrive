// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, assert, expect, it, vi } from "vitest";
import { valueSchemaFor } from "@/features/custom-fields/validate";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { CustomFieldDef } from "@/types/customFields";
import { customFieldReferenceOptions } from "../configurationReference";
import { initialDefinition } from "../editorModel";
import { disconnectNodes, removeNode } from "../graphEditor";
import { mappingOptions } from "../mappingOptions";
import copy from "../messages/workflows.en.json";
import { inspectReferences } from "../references";
import { actionRegistry } from "../registry";
import { bindingValue } from "../runBindings";
import type { RunOutputs, StepOutput } from "../runTypes";
import type { Binding, WorkflowDefinition, WorkflowNode } from "../schemas";
import { BindingField } from "./BindingField";
import { ConditionValue } from "./ConditionValue";

afterEach(cleanup);
const reference = (nodeId: string, field: string): Binding => ({
  kind: "reference",
  nodeId,
  path: [field],
});

function simpleGraph(): WorkflowDefinition {
  const graph = initialDefinition({
    start: "Manual start",
    read: "Read opportunity",
    task: "Create task",
    subject: "Follow up",
  });
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, nameMode: "custom" })) };
}
function branchGraph(): WorkflowDefinition {
  const graph = simpleGraph();
  const read = graph.nodes.find((node) => node.id === "read");
  assert(read !== undefined);
  return {
    ...graph,
    nodes: [
      ...graph.nodes,
      {
        id: "gate",
        type: "condition",
        version: 1,
        name: "Review branch",
        config: { left: reference("read", "status"), operator: "exists" },
      },
      { ...read, id: "branchRead", name: "True branch read" },
      { ...read, id: "siblingRead", name: "False branch read" },
      { ...read, id: "detachedRead", name: "Disconnected read" },
      {
        id: "later",
        type: "delay",
        version: 1,
        name: "Later wait",
        config: { minutes: { kind: "value", value: 1 } },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "gate", port: "next" },
      { from: "gate", to: "branchRead", port: "true" },
      { from: "branchRead", to: "task", port: "next" },
      { from: "gate", to: "siblingRead", port: "false" },
      { from: "task", to: "later", port: "next" },
    ],
  };
}
function conditionGraph(right: Binding) {
  const graph = simpleGraph();
  const node: WorkflowNode = {
    id: "compare",
    type: "condition",
    version: 1,
    name: "Compare",
    config: { left: right, operator: "equals", right },
  };
  return {
    definition: {
      ...graph,
      nodes: [...graph.nodes, node],
      edges: [...graph.edges, { from: "task", to: node.id, port: "next" as const }],
    },
    node,
  };
}
function bindingView(
  definition: WorkflowDefinition,
  value: Binding,
  onChange: (value: Binding) => void,
  kind: "text" | "deal" = "text",
) {
  return (
    <LocaleProvider locale="en">
      <BindingField
        definition={definition}
        nodeId="task"
        value={value}
        onChange={onChange}
        kind={kind}
        label={copy.subjectLabel}
        sourceLabel={copy.subjectSource}
        editable
        allowLiteral={false}
      />
    </LocaleProvider>
  );
}
function conditionView(
  definition: WorkflowDefinition,
  node: WorkflowNode,
  onChange: (value: Binding) => void,
  boolean = false,
) {
  return (
    <LocaleProvider locale="en">
      <ConditionValue
        definition={definition}
        node={node}
        editable
        boolean={boolean}
        status={false}
        onChange={onChange}
      />
    </LocaleProvider>
  );
}

it("offers only real connected ancestors and compatible deal identities on the chosen branch", () => {
  const graph = branchGraph();
  const before = structuredClone(graph);
  expect(mappingOptions(graph, "task", "deal").map((option) => option.key)).toEqual([
    "start.recordId",
    "read.id",
    "branchRead.id",
  ]);
  const scalar = mappingOptions(graph, "task", "scalar");
  expect(scalar.some((option) => option.key === "gate.result")).toBe(true);
  for (const id of ["task", "siblingRead", "later", "detachedRead"])
    expect(scalar.some((option) => option.node.id === id)).toBe(false);
  expect(graph).toEqual(before);
});

it("preserves missing, null, false, zero and empty values and rejects inherited output keys", () => {
  const record: StepOutput = {
    nil: null,
    no: false,
    zero: 0,
    empty: "",
    exact: "123456789012345.6700",
  };
  Object.setPrototypeOf(record, { inherited: "must not resolve" });
  const outputs: RunOutputs = { read: record };
  Object.setPrototypeOf(outputs, { ghost: { value: "must not resolve" } });
  for (const [field, value] of Object.entries(record))
    expect(bindingValue(reference("read", field), outputs)).toBe(value);
  expect(bindingValue(reference("absent", "value"), outputs)).toBeUndefined();
  expect(bindingValue(reference("read", "missing"), outputs)).toBeUndefined();
  expect(bindingValue(reference("read", "inherited"), outputs)).toBeUndefined();
  expect(bindingValue(reference("ghost", "value"), outputs)).toBeUndefined();
  expect(bindingValue({ kind: "value", value: null }, outputs)).toBeNull();
});

it("retains a selected reference after deletion or disconnection and reports its missing source without auto-binding", () => {
  const graph = simpleGraph();
  const before = structuredClone(graph);
  const value = reference("read", "id");
  const removed = removeNode(graph, "read");
  const onChange = vi.fn<(value: Binding) => void>();
  const task = removed.nodes.find((node) => node.id === "task");
  expect(task?.config.dealId).toEqual(value);
  expect(inspectReferences(removed)).toContainEqual({
    code: "unavailable_reference",
    nodeId: "task",
    field: "dealId",
  });
  const mounted = render(bindingView(removed, value, onChange, "deal"));
  expect(screen.getByRole("combobox", { name: copy.subjectSource })).toHaveTextContent(
    copy.unavailableValue,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(copy.mappingInvalid);
  const edge = graph.edges.find((item) => item.from === "read" && item.to === "task");
  assert(edge !== undefined);
  const disconnected = disconnectNodes(graph, edge);
  mounted.rerender(bindingView(disconnected, value, onChange, "deal"));
  expect(inspectReferences(disconnected)).toContainEqual({
    code: "unavailable_reference",
    nodeId: "task",
    field: "dealId",
  });
  expect(screen.getByRole("alert")).toHaveTextContent(copy.mappingInvalid);
  expect(onChange).not.toHaveBeenCalled();
  expect(graph).toEqual(before);
});

it("presents an existing reference as an inspectable typed source chip with a labeled example preview", () => {
  const graph = simpleGraph();
  const before = structuredClone(graph);
  const onChange = vi.fn<(value: Binding) => void>();
  render(bindingView(graph, reference("read", "title"), onChange));
  expect(screen.getByRole("combobox", { name: copy.subjectSource })).toHaveTextContent(
    "Read opportunity",
  );
  expect
    .soft(screen.queryByRole("button", { name: /inspect|show source|view source/i }))
    .not.toBeNull();
  const chip = screen.getByRole("group", { name: copy.mappingChipLabel });
  expect.soft(within(chip).queryByText("Text", { exact: true })).not.toBeNull();
  const preview = screen.getByRole("region", { name: copy.mappingPreviewTitle });
  expect.soft(within(preview).queryByText(copy.mappingSynthetic)).not.toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  expect(graph).toEqual(before);
});

it("offers and retains a stored exact-decimal comparison reference without numeric coercion", () => {
  const { definition, node } = conditionGraph(reference("read", "value"));
  const onChange = vi.fn<(value: Binding) => void>();
  expect
    .soft(mappingOptions(definition, node.id, "scalar"))
    .toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "read.value", type: "decimal" })]),
    );
  render(conditionView(definition, node, onChange));
  const mode = screen.getByRole("combobox", {
    name: copy.conditionValue + " · " + copy.configurationValueMode,
  });
  expect.soft(mode).toHaveTextContent(copy.fields.value);
  expect.soft(mode).not.toHaveTextContent(copy.unavailableValue);
  expect(node.config.right).toEqual(reference("read", "value"));
  expect(
    bindingValue(reference("read", "value"), { read: { value: "123456789012345.6700" } }),
  ).toBe("123456789012345.6700");
  expect(onChange).not.toHaveBeenCalled();
});

it("edits a stored numeric comparison as a number while preserving separate false and null controls", () => {
  const numeric = conditionGraph({ kind: "value", value: 0 });
  const before = structuredClone(numeric.definition);
  const onChange = vi.fn<(value: Binding) => void>();
  const mounted = render(conditionView(numeric.definition, numeric.node, onChange));
  const control = screen.getByRole("textbox", { name: copy.conditionValue });
  expect(control).toHaveValue("0");
  fireEvent.change(control, { target: { value: "1" } });
  expect.soft(onChange).toHaveBeenCalledExactlyOnceWith({ kind: "value", value: 1 });
  expect(numeric.node.config.right).toEqual({ kind: "value", value: 0 });
  expect(numeric.definition).toEqual(before);
  onChange.mockClear();
  const no = conditionGraph({ kind: "value", value: false });
  mounted.rerender(conditionView(no.definition, no.node, onChange, true));
  expect(screen.getByRole("combobox", { name: copy.conditionValue })).toHaveTextContent(
    copy.boolFalse,
  );
  const nil = conditionGraph({ kind: "value", value: null });
  mounted.rerender(conditionView(nil.definition, nil.node, onChange));
  expect(
    screen.getByRole("combobox", {
      name: copy.conditionValue + " · " + copy.configurationValueMode,
    }),
  ).toHaveTextContent(copy.configurationNullValue);
  expect(onChange).not.toHaveBeenCalled();
});

it("excludes generic text sources from a canonical date target's semantic choices", () => {
  const date: CustomFieldDef = {
    id: "bc55e85c-7b6f-4153-8742-2513f30a35dc",
    targetEntity: "activity",
    type: "date",
    name: "Follow-up date",
    key: "follow_up_date",
    options: [],
    isRequired: false,
    isImportant: false,
    showInAddForm: false,
    order: 0,
    archivedAt: null,
  };
  const schema = valueSchemaFor(date);
  expect(schema.safeParse("2026-11-04").success).toBe(true);
  expect(schema.safeParse("2026-02-30").success).toBe(false);
  expect(schema.safeParse(null).success).toBe(false);
  const choices = customFieldReferenceOptions(simpleGraph(), "task", date);
  expect.soft(choices.some((choice) => choice.key === "read.title")).toBe(false);
  expect.soft(choices.map((choice) => choice.key)).toEqual(["read.expectedCloseDate"]);
});

it("declares the finite real civil-date output and the existing wait's instant semantics", () => {
  expect.soft(actionRegistry["record.read"].outputs).toHaveProperty("expectedCloseDate", "date");
  expect.soft(actionRegistry.delay.outputs).toHaveProperty("resumeAt", "instant");
});
