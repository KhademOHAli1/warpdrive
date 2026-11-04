// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ConfigurationIssue } from "../configurationTypes";
import copy from "../messages/workflows.en.json";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { ConditionFields } from "./ConditionFields";
import {
  type ConfigValue,
  children,
  conditionNode,
  fixture,
  flat,
  GroupLocaleProvider,
  graphFromOutput,
  group,
  grouped,
  groupLocales,
  HistoryEditor,
  englishGroups as labels,
  literal,
  object,
  predicate,
  prepareGroupDom,
  reference,
} from "./conditionGroups.TestHelpers";

beforeAll(prepareGroupDom);
afterEach(cleanup);
function row(ordinal: string) {
  return screen.getByRole("group", { name: labels.row + " 1." + ordinal });
}
function rootGroup() {
  return screen.getByRole("group", { name: labels.group + " 1" });
}
function firstOperand(element: HTMLElement) {
  return within(element).getByRole("group", { name: copy.conditionField });
}
function editor(
  definition: WorkflowDefinition,
  changed: (node: WorkflowNode) => void,
  editable = true,
) {
  return (
    <LocaleProvider locale="en">
      <ConditionFields
        definition={definition}
        node={conditionNode(definition)}
        metadata={{ status: "complete", defs: [] }}
        editable={editable}
        onChange={changed}
      />
    </LocaleProvider>
  );
}
function history(definition: WorkflowDefinition, changed: (node: WorkflowNode) => void) {
  return (
    <LocaleProvider locale="en">
      <HistoryEditor initial={definition} changed={changed} />
    </LocaleProvider>
  );
}
function latest(changed: ReturnType<typeof vi.fn<(node: WorkflowNode) => void>>) {
  const found = changed.mock.calls.at(-1)?.[0];
  assert(found !== undefined);
  return found;
}
function operandOf(node: WorkflowNode, index: number) {
  return object(children(node.config.expression)[index]);
}

it.each(groupLocales)(
  "edits a localized ALL/ANY group and a qualified source without render mutation in $name",
  async (context) => {
    const test = fixture();
    const before = structuredClone(test.definition);
    const changed = vi.fn<(node: WorkflowNode) => void>();
    const mounted = render(
      <GroupLocaleProvider context={context}>
        <HistoryEditor initial={test.definition} changed={changed} />
      </GroupLocaleProvider>,
    );
    expect(changed).not.toHaveBeenCalled();
    const user = userEvent.setup();
    const match = screen.getByRole("combobox", { name: context.groups.match });
    expect(match).toHaveTextContent(context.groups.all);
    await user.click(match);
    await user.click(screen.getByRole("option", { name: context.groups.any }));
    expect(
      object(conditionNode(graphFromOutput(mounted.container)).config.expression).operator,
    ).toBe("or");
    const one = new Intl.NumberFormat(context.locale, {
      numberingSystem: context.numberingSystem,
    }).format(1);
    expect(
      screen.getByRole("group", { name: context.groups.row + " " + one + "." + one }),
    ).toBeInTheDocument();
    const fields = screen.getAllByRole("group", { name: context.copy.conditionField });
    const first = fields[0];
    assert(first !== undefined);
    await user.click(within(first).getByRole("button", { name: context.copy.mappingChooseSource }));
    const dialog = screen.getByRole("dialog", { name: context.copy.mappingPickerTitle });
    fireEvent.change(within(dialog).getByRole("textbox", { name: context.copy.mappingSearch }), {
      target: { value: "Read opportunity" },
    });
    const choice = within(dialog).getByRole("button", {
      name: new RegExp(context.copy.fields.currency),
    });
    expect(choice).toHaveTextContent("Read opportunity");
    expect(choice).toHaveTextContent(
      new Intl.NumberFormat(context.locale, { numberingSystem: context.numberingSystem }).format(2),
    );
    await user.click(choice);
    const next = conditionNode(graphFromOutput(mounted.container));
    expect(operandOf(next, 0).left).toEqual(reference("currency"));
    expect(operandOf(next, 0).id).toBe("title_rule");
    expect(operandOf(next, 1)).toEqual(operandOf(test.node, 1));
    expect(changed).toHaveBeenCalledTimes(2);
    expect(test.definition).toEqual(before);
  },
);

it("keeps legacy bytes inert until explicit conversion and makes conversion one reversible history edit", async () => {
  const test = fixture(flat());
  const bytes = JSON.stringify(test.definition);
  const configBytes = JSON.stringify(test.node.config);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const mounted = render(history(test.definition, changed));
  const user = userEvent.setup();
  expect(JSON.stringify(graphFromOutput(mounted.container))).toBe(bytes);
  expect(changed).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: labels.convert }));
  expect(changed).toHaveBeenCalledTimes(1);
  const next = conditionNode(graphFromOutput(mounted.container));
  expect(next.config.defaultPort).toBe("false");
  const entries = children(next.config.expression);
  expect(entries).toHaveLength(1);
  const converted = object(entries[0]);
  expect(converted.left).toEqual(test.node.config.left);
  expect(JSON.stringify(converted.left)).toBe(JSON.stringify(test.node.config.left));
  expect(converted.right).toEqual(test.node.config.right);
  expect(converted.operator).toBe(test.node.config.operator);
  expect(graphFromOutput(mounted.container).edges).toEqual(test.definition.edges);
  expect(graphFromOutput(mounted.container).nodes.map((node) => node.id)).toEqual(
    test.definition.nodes.map((node) => node.id),
  );
  const convertedBytes = JSON.stringify(graphFromOutput(mounted.container));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(JSON.stringify(graphFromOutput(mounted.container))).toBe(bytes);
  await user.click(screen.getByRole("button", { name: "Redo" }));
  expect(JSON.stringify(graphFromOutput(mounted.container))).toBe(convertedBytes);
  expect(JSON.stringify(test.node.config)).toBe(configBytes);
  mounted.unmount();
  changed.mockClear();
  const unsupported = fixture({ right: literal(1), operator: "greaterThan", left: literal(2) });
  const unsupportedBytes = JSON.stringify(unsupported.definition);
  const retained = render(history(unsupported.definition, changed));
  const convert = screen.getByRole("button", { name: labels.convert });
  expect(convert).toBeDisabled();
  await user.click(convert);
  expect(JSON.stringify(graphFromOutput(retained.container))).toBe(unsupportedBytes);
  expect(changed).not.toHaveBeenCalled();
});
it("adds and removes a stable predicate while retaining its sibling and restoring useful focus", async () => {
  const test = fixture(
    grouped([predicate("kept_rule", reference("title"), "equals", literal("Customer"))]),
  );
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const mounted = render(history(test.definition, changed));
  const user = userEvent.setup();
  await user.click(within(rootGroup()).getByRole("button", { name: labels.add }));
  const entries = children(conditionNode(graphFromOutput(mounted.container)).config.expression);
  expect(entries).toHaveLength(2);
  expect(object(entries[0]).id).toBe("kept_rule");
  expect(typeof object(entries[1]).id).toBe("string");
  expect(object(entries[1]).id).not.toBe("kept_rule");
  const input = within(row("1")).getByRole("textbox", { name: copy.conditionValue });
  const originalId = input.id;
  await user.click(within(row("2")).getByRole("button", { name: labels.remove }));
  expect(children(conditionNode(graphFromOutput(mounted.container)).config.expression)).toEqual([
    object(entries[0]),
  ]);
  expect(within(row("1")).getByRole("textbox", { name: copy.conditionValue }).id).toBe(originalId);
  await waitFor(() =>
    expect([
      within(rootGroup()).getByRole("button", { name: labels.add }),
      ...within(row("1")).getAllByRole("button"),
    ]).toContain(document.activeElement),
  );
  expect(changed).toHaveBeenCalledTimes(2);
});
it("nests a group and reorders only expression children with one undoable edit per action", async () => {
  const test = fixture();
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const mounted = render(history(test.definition, changed));
  const user = userEvent.setup();
  await user.click(within(rootGroup()).getByRole("button", { name: labels.addGroup }));
  const nestedGroup = screen.getByRole("group", { name: labels.group + " 1.3" });
  await user.click(within(nestedGroup).getByRole("button", { name: labels.add }));
  const beforeMove = graphFromOutput(mounted.container);
  const nested = object(children(conditionNode(beforeMove).config.expression)[2]);
  expect(children(nested)).toHaveLength(1);
  await user.click(within(row("2")).getByRole("button", { name: labels.earlier }));
  const next = graphFromOutput(mounted.container);
  expect(children(conditionNode(next).config.expression).map((item) => object(item).id)).toEqual([
    "value_rule",
    "title_rule",
    nested.id,
  ]);
  expect(next.edges).toEqual(test.definition.edges);
  expect(next.nodes.map((node) => node.id)).toEqual(test.definition.nodes.map((node) => node.id));
  expect(changed).toHaveBeenCalledTimes(3);
  await user.click(screen.getByRole("button", { name: "Undo" }));
  expect(graphFromOutput(mounted.container)).toEqual(beforeMove);
});
function boundCase(config: WorkflowNode["config"], groupName: string, action: string) {
  const test = fixture(config);
  const changed = vi.fn();
  const mounted = render(editor(test.definition, changed));
  const area = screen.getByRole("group", { name: groupName });
  const button = within(area)
    .getAllByRole("button", { name: action })
    .find((candidate) => candidate.closest("fieldset") === area);
  assert(button !== undefined);
  expect(button).toBeDisabled();
  expect(area).toHaveTextContent(labels.bound);
  expect(changed).not.toHaveBeenCalled();
  mounted.unmount();
}
it("enforces each finite group budget and retains empty and over-limit drafts without truncation", () => {
  boundCase(
    grouped(
      Array.from({ length: 8 }, (_, index) =>
        predicate("child_" + index, reference("title"), "exists"),
      ),
    ),
    labels.group + " 1",
    labels.add,
  );
  boundCase(
    grouped([
      group("middle", "and", [
        group("deepest", "and", [predicate("last", reference("title"), "exists")]),
      ]),
    ]),
    labels.group + " 1.1.1",
    labels.addGroup,
  );
  boundCase(
    grouped(
      Array.from({ length: 4 }, (_, groupIndex) =>
        group(
          "batch_" + groupIndex,
          "and",
          Array.from({ length: 8 }, (_, index) =>
            predicate("p_" + groupIndex + "_" + index, reference("title"), "exists"),
          ),
        ),
      ),
    ),
    labels.group + " 1",
    labels.add,
  );
  const total: ConfigValue[] = Array.from({ length: 8 }, (_, groupIndex) =>
    group(
      "outer_" + groupIndex,
      "and",
      groupIndex < 7
        ? [
            group(
              "inner_" + groupIndex,
              "and",
              Array.from({ length: 4 }, (_, index) =>
                predicate("t_" + groupIndex + "_" + index, reference("title"), "exists"),
              ),
            ),
          ]
        : Array.from({ length: 4 }, (_, index) =>
            predicate("tail_" + index, reference("title"), "exists"),
          ),
    ),
  );
  boundCase(grouped(total), labels.group + " 1.1", labels.addGroup);
  const empty = fixture(grouped([]));
  const changed = vi.fn();
  const view = render(editor(empty.definition, changed));
  expect(rootGroup()).toHaveTextContent(labels.omitted);
  expect(within(rootGroup()).getByRole("button", { name: labels.add })).toBeEnabled();
  view.unmount();
  const invalid = fixture(
    grouped([
      group("a", "and", [
        group("b", "and", [
          group("c", "and", [predicate("too_deep", reference("title"), "exists")]),
        ]),
      ]),
    ]),
  );
  const before = JSON.stringify(invalid.definition);
  render(editor(invalid.definition, changed));
  expect(screen.getByRole("alert")).toHaveTextContent(labels.invalid);
  expect(changed).not.toHaveBeenCalled();
  expect(JSON.stringify(invalid.definition)).toBe(before);
});
it("associates a nested RHS issue with its own stable input and repairs no sibling", async () => {
  const config = grouped([
    predicate("kept", reference("title"), "exists"),
    group("nested", "or", [predicate("missing", reference("title"), "equals")]),
  ]);
  const test = fixture(config);
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const issues: ConfigurationIssue[] = [
    {
      nodeId: "check",
      path: ["expression", "children", "1", "children", "0", "right"],
      code: "required",
    },
  ];
  render(
    <LocaleProvider locale="en">
      <ConditionFields
        definition={test.definition}
        node={test.node}
        editable
        onChange={changed}
        issues={issues}
        metadata={{ status: "complete", defs: [] }}
      />
    </LocaleProvider>,
  );
  const input = within(row("2.1")).getByRole("textbox", { name: copy.conditionValue });
  expect(input).toHaveAttribute("aria-invalid", "true");
  const errorId = input.getAttribute("aria-describedby");
  assert(errorId !== null);
  expect(document.getElementById(errorId)).toHaveTextContent(copy.configurationRequired);
  await userEvent.setup().click(input);
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "Repaired" } });
  const next = latest(changed);
  expect(children(next.config.expression)[0]).toEqual(children(test.node.config.expression)[0]);
  const nested = object(children(next.config.expression)[1]);
  expect(object(children(nested)[0]).right).toEqual(literal("Repaired"));
  expect(changed).toHaveBeenCalledTimes(1);
});
it("guards readonly and denied transitions during an open picker and uses an effective-disabled focus fallback", async () => {
  const test = fixture();
  const changed = vi.fn();
  const draw = (editable: boolean, denied: boolean) => (
    <LocaleProvider locale="en">
      <fieldset disabled={!editable}>
        <ConditionFields
          definition={test.definition}
          node={test.node}
          editable={editable}
          onChange={changed}
          metadata={denied ? { status: "denied" } : { status: "complete", defs: [] }}
        />
      </fieldset>
    </LocaleProvider>
  );
  const mounted = render(draw(true, false));
  const user = userEvent.setup();
  await user.click(
    within(firstOperand(row("1"))).getByRole("button", { name: copy.mappingChooseSource }),
  );
  mounted.rerender(draw(false, true));
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", { name: /Read opportunity/ }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(
      within(firstOperand(row("1"))).getByRole("region", { name: copy.mappingPreviewTitle }),
    ).toHaveFocus(),
  );
  expect(within(rootGroup()).getByRole("button", { name: labels.add })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
});
it("retains native zero, false and invalid numeric raw intent in their own predicate contexts", () => {
  const test = fixture(
    grouped([
      predicate("zero", literal(0), "equals", literal(0)),
      predicate("false_value", literal(false), "equals", literal(false)),
    ]),
  );
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const mounted = render(history(test.definition, changed));
  const numeric = within(row("1")).getByRole("textbox", { name: copy.conditionValue });
  expect(numeric).toHaveValue("0");
  expect(within(row("2")).getByRole("combobox", { name: copy.conditionValue })).toHaveTextContent(
    copy.boolFalse,
  );
  fireEvent.change(numeric, { target: { value: "-" } });
  fireEvent.blur(numeric);
  const next = conditionNode(graphFromOutput(mounted.container));
  expect(operandOf(next, 0).right).toEqual({ kind: "value", value: "-", literalType: "number" });
  expect(operandOf(next, 1).right).toEqual(literal(false));
  expect(numeric).toHaveValue("-");
  expect(changed).toHaveBeenCalledTimes(1);
});
it("labels exact decimal context while preserving full and fragment strings without converting a native-number mismatch", async () => {
  const test = fixture(
    grouped([predicate("decimal", reference("value"), "equals", literal("0012.3400"))]),
  );
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const mounted = render(history(test.definition, changed));
  const user = userEvent.setup();
  const input = within(row("1")).getByRole("textbox", { name: copy.conditionValue });
  expect(row("1")).toHaveTextContent(copy.mappingTypes.decimal);
  expect(input).toHaveValue("0012.3400");
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "00012.3400" } });
  expect(operandOf(conditionNode(graphFromOutput(mounted.container)), 0).right).toEqual(
    literal("00012.3400"),
  );
  await user.click(within(row("1")).getByRole("combobox", { name: copy.conditionOperator }));
  await user.click(screen.getByRole("option", { name: copy.contains }));
  expect(row("1")).toHaveTextContent("Text fragment");
  fireEvent.change(input, { target: { value: ".3400" } });
  expect(operandOf(conditionNode(graphFromOutput(mounted.container)), 0).right).toEqual(
    literal(".3400"),
  );
  mounted.unmount();
  changed.mockClear();
  const invalid = fixture(
    grouped([predicate("decimal", reference("value"), "equals", literal(12))]),
  );
  render(editor(invalid.definition, changed));
  expect(within(row("1")).getByRole("textbox", { name: copy.conditionValue })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(operandOf(invalid.node, 0).right).toEqual(literal(12));
  expect(changed).not.toHaveBeenCalled();
});
it("revalidates the captured predicate identity after a modal-open reorder rather than redirecting an old path", async () => {
  const test = fixture();
  const changed = vi.fn<(node: WorkflowNode) => void>();
  const mounted = render(editor(test.definition, changed));
  const user = userEvent.setup();
  await user.click(
    within(firstOperand(row("1"))).getByRole("button", { name: copy.mappingChooseSource }),
  );
  const values = children(test.node.config.expression);
  const first = values[0];
  const second = values[1];
  assert(first !== undefined && second !== undefined);
  const reordered = fixture(grouped([second, first]));
  mounted.rerender(editor(reordered.definition, changed));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: new RegExp(copy.fields.currency),
    }),
  );
  expect(changed).not.toHaveBeenCalled();
  if (screen.queryByRole("dialog") !== null) await user.keyboard("{Escape}");
  await user.click(
    within(firstOperand(row("2"))).getByRole("button", { name: copy.mappingChooseSource }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: new RegExp(copy.fields.currency),
    }),
  );
  expect(changed).toHaveBeenCalledTimes(1);
  expect(operandOf(latest(changed), 1).id).toBe("title_rule");
  expect(operandOf(latest(changed), 1).left).toEqual(reference("currency"));
  expect(operandOf(latest(changed), 0)).toEqual(object(values[1]));
  const missing = {
    ...reordered.definition,
    nodes: reordered.definition.nodes.filter((node) => node.id !== "read"),
    edges: reordered.definition.edges.filter((edge) => edge.from !== "read" && edge.to !== "read"),
  };
  mounted.rerender(editor(missing, changed));
  expect(firstOperand(row("2"))).toHaveTextContent(copy.unavailableValue);
  expect(changed).toHaveBeenCalledTimes(1);
});
it("closes a same-binding choice with reordered keys without creating a callback or undo entry", async () => {
  const selected = { path: ["title"], kind: "reference", nodeId: "read" };
  const test = fixture(grouped([predicate("same", selected, "equals", literal("Customer"))]));
  const changed = vi.fn();
  const mounted = render(history(test.definition, changed));
  const user = userEvent.setup();
  const opener = within(firstOperand(row("1"))).getByRole("button", {
    name: copy.mappingChooseSource,
  });
  await user.click(opener);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: new RegExp(copy.fields.title) }),
  );
  await waitFor(() => expect(opener).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(changed).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(graphFromOutput(mounted.container)).toEqual(test.definition);
});
