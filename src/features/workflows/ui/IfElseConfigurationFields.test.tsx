// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, assert, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { ConfigurationMetadata } from "../configurationTypes";
import { initialDefinition } from "../editorModel";
import {
  type BranchPort,
  branchPort,
  ifElsePorts,
  newIfElseBranch,
  newIfElseConfig,
  parseIfElseConfig,
} from "../ifElse";
import copy from "../messages/workflows.en.json";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { children, prepareGroupDom, reference } from "./conditionGroups.TestHelpers";
import { IfElseConfigurationFields } from "./IfElseConfigurationFields";

beforeAll(prepareGroupDom);
afterEach(cleanup);

function fixture(connected = false) {
  const graph = initialDefinition({
    start: "Start",
    read: "Read opportunity",
    task: "Task",
    subject: "Call",
  });
  const config = newIfElseConfig();
  if (connected) config.branches.push(newIfElseBranch("follow_up"));
  const node: WorkflowNode = {
    id: "switch",
    name: "Choose a route",
    type: "ifElse",
    version: 1,
    config,
  };
  graph.nodes.push(node);
  graph.edges = [
    { from: "start", to: "read", port: "next" },
    { from: "read", to: node.id, port: "next" },
    ...(connected ? [{ from: node.id, to: "task", port: branchPort("follow_up") }] : []),
  ];
  return { graph, node };
}

function Editor({
  initial,
  onChange,
}: {
  initial: WorkflowDefinition;
  onChange: (node: WorkflowNode) => void;
}) {
  const [definition, setDefinition] = useState(initial);
  const node = definition.nodes.find((item) => item.id === "switch");
  assert(node !== undefined);
  return (
    <LocaleProvider locale="en">
      <IfElseConfigurationFields
        definition={definition}
        node={node}
        editable
        metadata={{ status: "complete", defs: [] }}
        onChange={(changed) => {
          onChange(changed);
          setDefinition((current) => ({
            ...current,
            nodes: current.nodes.map((item) => (item.id === changed.id ? changed : item)),
          }));
        }}
      />
    </LocaleProvider>
  );
}

it("adds a route before Else and maps a real upstream value into only that route", async () => {
  const { graph, node } = fixture();
  const before = structuredClone(graph);
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  render(<Editor initial={graph} onChange={onChange} />);
  const user = userEvent.setup();
  expect(screen.getByRole("region", { name: copy.ifElseIf, exact: true })).toBeVisible();
  expect(screen.getByText(copy.ifElseFallback)).toBeVisible();
  expect(screen.queryByText(copy.conditionOtherwise)).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: copy.ifElseAddRoute }));
  const added = onChange.mock.calls[0]?.[0];
  assert(added !== undefined);
  const ports = ifElsePorts(added.config);
  expect(ports).toEqual(["branch:if", expect.stringMatching(/^branch:route_/), "branch:else"]);

  const route = screen.getByRole("region", { name: "Else if 1" });
  const operand = within(route).getByRole("group", { name: copy.conditionField });
  await user.click(within(operand).getByRole("button", { name: copy.mappingChooseSource }));
  const picker = screen.getByRole("dialog", { name: copy.mappingPickerTitle });
  await user.click(within(picker).getByRole("button", { name: new RegExp(copy.fields.title) }));
  const changed = onChange.mock.calls.at(-1)?.[0];
  assert(changed !== undefined);
  expect(changed.type).toBe(node.type);
  expect(ifElsePorts(changed.config)).toEqual(ports);
  const parsed = parseIfElseConfig(changed.config, "draft");
  const original = parseIfElseConfig(node.config, "draft");
  assert(parsed.ok && original.ok);
  expect(parsed.value.branches[0]).toEqual(original.value.branches[0]);
  const mapped = parsed.value.branches[1];
  assert(mapped !== undefined);
  expect(children(mapped.predicate.expression)[0]).toMatchObject({ left: reference("title") });
  expect(parseIfElseConfig(changed.config, "execute").ok).toBe(false);
  expect(graph).toEqual(before);
});

it("requires an atomic graph handler to remove a connected route", async () => {
  const { graph, node } = fixture(true);
  const before = structuredClone(graph);
  const onChange = vi.fn<(node: WorkflowNode) => void>();
  const removeConnected = vi.fn<(node: WorkflowNode, port: BranchPort) => void>();
  function view(handler?: typeof removeConnected) {
    return (
      <LocaleProvider locale="en">
        <IfElseConfigurationFields
          definition={graph}
          node={node}
          editable
          onChange={onChange}
          onRemoveConnectedRoute={handler}
        />
      </LocaleProvider>
    );
  }
  const mounted = render(view());
  const remove = () => screen.getByRole("button", { name: "Remove route 1" });
  expect(remove()).toBeDisabled();
  expect(remove()).toHaveAccessibleDescription(copy.ifElseDisconnectRoute);
  const user = userEvent.setup();
  await user.click(remove());
  expect(onChange).not.toHaveBeenCalled();
  mounted.rerender(view(removeConnected));
  await user.click(remove());
  expect(removeConnected).toHaveBeenCalledTimes(1);
  const [updated, port] = removeConnected.mock.calls[0] ?? [];
  expect(port).toBe("branch:follow_up");
  expect(ifElsePorts(updated?.config)).toEqual(["branch:if", "branch:else"]);
  expect(onChange).not.toHaveBeenCalled();
  expect(graph).toEqual(before);
});

it("leaves retained routes inspectable without edit controls when metadata is denied", () => {
  const { graph, node } = fixture(true);
  const onChange = vi.fn();
  const metadata: ConfigurationMetadata = { status: "denied" };
  render(
    <LocaleProvider locale="en">
      <IfElseConfigurationFields
        definition={graph}
        node={node}
        editable
        onChange={onChange}
        metadata={metadata}
      />
    </LocaleProvider>,
  );
  const route = screen.getByRole("region", { name: "Else if 1" });
  expect(within(route).getByRole("combobox", { name: copy.conditionMatch })).toBeDisabled();
  expect(screen.queryByRole("button", { name: copy.ifElseAddRoute })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove route 1" })).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});
