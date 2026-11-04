// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { evaluateCondition } from "../condition";
import { inspectGraph } from "../graph";
import { connectNodes } from "../graphEditor";
import copy from "../messages/workflows.en.json";
import type { RunOutputs } from "../runTypes";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "../schemas";
import { ConditionFields } from "./ConditionFields";
import { ConnectionEditor } from "./ConnectionEditor";
import { EdgeInspector } from "./EdgeInspector";
import { NodeSummary } from "./NodeSummary";

afterEach(cleanup);
type ConfigValue = WorkflowNode["config"][string];
const reference = (field: string) => ({
  kind: "reference" as const,
  nodeId: "read",
  path: [field],
});
const literal = (value: string | number | boolean | null) => ({ kind: "value" as const, value });

function predicate(
  id: string,
  left: ConfigValue,
  operator: string,
  right?: ConfigValue,
): ConfigValue {
  return { kind: "predicate", id, left, operator, ...(right === undefined ? {} : { right }) };
}
function group(id: string, operator: "and" | "or", children: ConfigValue[]): ConfigValue {
  return { kind: "group", id, operator, children };
}
function grouped(expression: ConfigValue): WorkflowNode["config"] {
  return { expression, defaultPort: "false" };
}
function flat(): WorkflowNode["config"] {
  return { left: reference("status"), operator: "equals", right: literal("open") };
}
function fixture(config: WorkflowNode["config"] = flat()) {
  const node: WorkflowNode = {
    id: "check",
    type: "condition",
    version: 1,
    name: "Qualify opportunity",
    nameMode: "custom",
    config,
  };
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.manual",
        version: 1,
        name: "Manual start",
        nameMode: "custom",
        config: {},
      },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read opportunity",
        nameMode: "custom",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      node,
      {
        id: "matched",
        type: "activity.create",
        version: 1,
        name: "Matched path",
        nameMode: "custom",
        config: { subject: literal("Matched opportunity"), dealId: reference("id") },
      },
      {
        id: "otherwise",
        type: "activity.create",
        version: 1,
        name: "Default path",
        nameMode: "custom",
        config: { subject: literal("Other opportunity"), dealId: reference("id") },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "check", port: "next" },
      { from: "check", to: "matched", port: "true" },
      { from: "check", to: "otherwise", port: "false" },
    ],
  };
  return { definition, node, context: { definition, nodeId: node.id } };
}
function nestedConfig() {
  return grouped(
    group("all_rules", "and", [
      predicate("open_status", reference("status"), "equals", literal("open")),
      group("any_detail", "or", [
        predicate("customer_title", reference("title"), "contains", literal("Customer")),
        predicate("known_date", reference("expectedCloseDate"), "exists"),
      ]),
    ]),
  );
}

it("control: preserves legacy primitive presence, own-key access and exact-decimal contains", () => {
  for (const [value, result] of [
    [null, false],
    [false, true],
    [0, true],
    ["", true],
  ] as const) {
    expect(evaluateCondition({ left: literal(value), operator: "exists" }, {})).toEqual({
      ok: true,
      value: { result },
    });
  }
  expect(
    evaluateCondition({ left: literal("1"), operator: "equals", right: literal(1) }, {}),
  ).toEqual({ ok: true, value: { result: false } });
  const config = { left: reference("value"), operator: "contains", right: literal(".3400") };
  const test = fixture(config);
  expect(evaluateCondition(config, { read: { value: "0012.3400" } }, test.context)).toEqual({
    ok: true,
    value: { result: true },
  });
  const inherited: RunOutputs = {};
  Object.setPrototypeOf(inherited, { read: { value: "0012.3400" } });
  expect(evaluateCondition(config, inherited, test.context)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
  });
  expect(inspectGraph(test.definition)).toEqual([]);
});

it("control: rejects implicit joins and duplicate exclusive output ports without editing the graph", () => {
  const test = fixture();
  const before = structuredClone(test.definition);
  expect(connectNodes(test.definition, { from: "otherwise", to: "matched", port: "next" })).toEqual(
    { ok: false, error: "occupiedInput" },
  );
  expect(connectNodes(test.definition, { from: "check", to: "otherwise", port: "true" })).toEqual({
    ok: false,
    error: "occupiedOutput",
  });
  expect(
    inspectGraph({
      ...test.definition,
      edges: [...test.definition.edges, { from: "otherwise", to: "matched", port: "next" }],
    }),
  ).toContainEqual({ code: "invalid_incoming", nodeId: "matched" });
  expect(
    inspectGraph({
      ...test.definition,
      edges: [...test.definition.edges, { from: "check", to: "otherwise", port: "true" }],
    }),
  ).toContainEqual({ code: "duplicate_port", nodeId: "check" });
  expect(test.definition).toEqual(before);
});

it("control: displays a real legacy status comparison, emits one explicit edit and keeps readonly controls immutable", async () => {
  const test = fixture();
  const before = structuredClone(test.definition);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const view = render(
    <LocaleProvider locale="en">
      <ConditionFields definition={test.definition} node={test.node} editable onChange={changed} />
    </LocaleProvider>,
  );
  expect(screen.getByRole("combobox", { name: copy.conditionValue })).toHaveTextContent("Open");
  expect(changed).not.toHaveBeenCalled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: copy.conditionOperator }));
  await user.click(screen.getByRole("option", { name: copy.notEquals, exact: true }));
  expect(changed).toHaveBeenCalledExactlyOnceWith({
    ...test.node,
    config: { ...test.node.config, operator: "notEquals" },
  });
  changed.mockClear();
  view.rerender(
    <LocaleProvider locale="en">
      <ConditionFields
        definition={test.definition}
        node={test.node}
        editable={false}
        onChange={changed}
      />
    </LocaleProvider>,
  );
  const readonly = screen.getByRole("combobox", { name: copy.conditionOperator });
  expect(readonly).toBeDisabled();
  await user.click(readonly);
  expect(changed).not.toHaveBeenCalled();
  expect(test.definition).toEqual(before);
});

it("gap: evaluates a bounded nested AND/OR expression using the real upstream graph and explicit default", () => {
  const config = nestedConfig();
  const test = fixture(config);
  expect(definitionSchema.safeParse(test.definition).success).toBe(true);
  expect(inspectGraph(test.definition)).toEqual([]);
  const before = structuredClone(test.definition);
  expect
    .soft(
      evaluateCondition(
        config,
        { read: { status: "open", title: "Customer follow-up", expectedCloseDate: null } },
        test.context,
      ),
    )
    .toEqual({ ok: true, value: { result: true } });
  expect
    .soft(
      evaluateCondition(
        config,
        { read: { status: "won", title: "Customer follow-up", expectedCloseDate: null } },
        test.context,
      ),
    )
    .toEqual({ ok: true, value: { result: false } });
  expect(test.definition).toEqual(before);
});

it("gap: short-circuits valid runtime-missing operands in order but never sends a needed missing value to default", () => {
  const config = grouped(
    group("first_match", "or", [
      predicate("open_status", reference("status"), "equals", literal("open")),
      predicate("date_available", reference("expectedCloseDate"), "exists"),
    ]),
  );
  const test = fixture(config);
  expect(inspectGraph(test.definition)).toEqual([]);
  expect
    .soft(evaluateCondition(config, { read: { status: "open" } }, test.context))
    .toEqual({ ok: true, value: { result: true } });
  expect
    .soft(evaluateCondition(config, { read: { status: "won" } }, test.context))
    .toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_BINDING_MISSING });
  const invalid = grouped(
    group("invalid_unvisited", "or", [
      predicate("open_status", reference("status"), "equals", literal("open")),
      predicate("unknown_property", reference("undeclaredField"), "exists"),
    ]),
  );
  const invalidTest = fixture(invalid);
  expect
    .soft(evaluateCondition(invalid, { read: { status: "open" } }, invalidTest.context))
    .toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
});

it("gap: exposes readable ALL/ANY groups and multiple real predicate controls without an automatic edit", () => {
  const test = fixture(nestedConfig());
  const before = structuredClone(test.definition);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  render(
    <LocaleProvider locale="en">
      <section aria-label="Condition editor">
        <ConditionFields
          definition={test.definition}
          node={test.node}
          editable
          onChange={changed}
        />
      </section>
    </LocaleProvider>,
  );
  const editor = within(screen.getByRole("region", { name: "Condition editor" }));
  expect(changed).not.toHaveBeenCalled();
  expect.soft(editor.queryAllByText(/\ball\b.*\band\b/i).length).toBeGreaterThan(0);
  expect.soft(editor.queryAllByText(/\bany\b.*\bor\b/i).length).toBeGreaterThan(0);
  expect
    .soft(editor.queryAllByRole("button", { name: /add condition/i }).length)
    .toBeGreaterThan(0);
  expect
    .soft(editor.queryAllByRole("combobox", { name: new RegExp(copy.conditionField) }).length)
    .toBeGreaterThanOrEqual(2);
  expect(test.definition).toEqual(before);
});

it("gap: names the existing false wire port as the explicit default in both connection surfaces", () => {
  const test = fixture(nestedConfig());
  const edge = test.definition.edges.find(
    (candidate) => candidate.from === "check" && candidate.port === "false",
  );
  assert(edge !== undefined);
  const before = structuredClone(test.definition);
  const changed = vi.fn<(graph: WorkflowDefinition) => void>();
  const connected = render(
    <LocaleProvider locale="en">
      <ConnectionEditor
        definition={test.definition}
        node={test.node}
        editable
        onChange={changed}
        onProblem={vi.fn()}
      />
    </LocaleProvider>,
  );
  expect(within(connected.container).getAllByRole("combobox")).toHaveLength(2);
  expect
    .soft(within(connected.container).queryByRole("combobox", { name: /otherwise.*default/i }))
    .toBeInTheDocument();
  const inspected = render(
    <LocaleProvider locale="en">
      <EdgeInspector
        definition={test.definition}
        edge={edge}
        editable
        onChange={changed}
        onProblem={vi.fn()}
        onClose={vi.fn()}
      />
    </LocaleProvider>,
  );
  expect
    .soft(within(inspected.container).getByRole("combobox", { name: copy.connectionPort }))
    .toHaveTextContent(/otherwise.*default/i);
  expect(
    test.definition.edges
      .filter((candidate) => candidate.from === "check")
      .map((candidate) => candidate.port),
  ).toEqual(["true", "false"]);
  expect(changed).not.toHaveBeenCalled();
  expect(test.definition).toEqual(before);
});

it("gap: summarizes valid null and empty-text predicates distinctly from incomplete setup", () => {
  const nullTest = fixture({ left: reference("value"), operator: "equals", right: literal(null) });
  const emptyTest = fixture({ left: reference("title"), operator: "equals", right: literal("") });
  const nullView = render(
    <LocaleProvider locale="en">
      <NodeSummary node={nullTest.node} />
    </LocaleProvider>,
  );
  const emptyView = render(
    <LocaleProvider locale="en">
      <NodeSummary node={emptyTest.node} />
    </LocaleProvider>,
  );
  expect.soft(nullView.container).toHaveTextContent(/null|no value/i);
  expect.soft(nullView.container).not.toHaveTextContent(copy.setupRequired);
  expect.soft(emptyView.container).toHaveTextContent(/empty(?: text|string)?|""|“”/i);
  expect.soft(emptyView.container).not.toHaveTextContent(copy.setupRequired);
  expect(nullTest.node.config.right).toEqual(literal(null));
  expect(emptyTest.node.config.right).toEqual(literal(""));
});
