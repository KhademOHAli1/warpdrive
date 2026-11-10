// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { workflowIteratorMaxItems } from "../workflowIteratorRuntimeContract";
import { IteratorConfigurationFields } from "./IteratorConfigurationFields";

const nodeConfig = { items: { kind: "literal", itemKind: "text", items: [] } };
const start: WorkflowNode = {
  id: "start",
  type: "trigger.manual",
  version: 1,
  name: "Start",
  config: {},
};
const search: WorkflowNode = {
  id: "search",
  type: "record.search",
  version: 1,
  name: "Find contacts",
  config: {},
};
const disconnected: WorkflowNode = { ...search, id: "other", name: "Other records" };
const edges: WorkflowDefinition["edges"] = [
  { from: "start", to: "search", port: "next" },
  { from: "search", to: "iterate", port: "next" },
];

afterEach(cleanup);

function Harness({
  editable = true,
  config = nodeConfig,
  onChange,
}: {
  editable?: boolean;
  config?: WorkflowNode["config"];
  onChange: (next: WorkflowNode) => void;
}) {
  const [node, setNode] = useState<WorkflowNode>({
    id: "iterate",
    type: "iterator" as WorkflowNode["type"],
    version: 1,
    name: "Iterator",
    config,
  });
  return (
    <LocaleProvider locale="en">
      <IteratorConfigurationFields
        node={node}
        definition={{ schemaVersion: 1, nodes: [start, search, disconnected, node], edges }}
        editable={editable}
        validation={{ status: "valid", issues: [], runtimeChecks: [] }}
        onChange={(next) => {
          setNode(next);
          onChange(next);
        }}
      />
    </LocaleProvider>
  );
}

it("edits ordered literal items without stringifying explicit nulls", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const opener = screen.getByRole("button", { name: "Items to iterate over" });
  await user.click(opener);
  const dialog = within(screen.getByRole("dialog", { name: "Items to iterate over" }));
  const item = dialog.getByRole("textbox", { name: "Item value" });
  await user.type(item, "first{Enter}");
  await user.click(dialog.getByRole("button", { name: "Use null" }));
  await user.click(dialog.getByRole("button", { name: "Add item" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { items: { kind: "literal", itemKind: "text", items: ["first", null] } },
    }),
  );
  await user.click(dialog.getByRole("button", { name: "first" }));
  await user.clear(item);
  await user.type(item, "edited");
  await user.click(dialog.getByRole("button", { name: "Update item" }));
  expect(opener).toHaveTextContent("edited");
  await user.click(dialog.getByRole("button", { name: "Remove item 1" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { items: { kind: "literal", itemKind: "text", items: [null] } },
    }),
  );
  await user.keyboard("{Escape}");
  expect(opener).toHaveFocus();
});

it("authors numeric values and keeps one consistent type for a nonempty list", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "Items to iterate over" }));
  const kind = screen.getByRole("combobox", { name: "Item type" });
  await user.click(kind);
  await user.click(screen.getByRole("option", { name: "Number" }));
  await user.type(screen.getByRole("textbox", { name: "Item value" }), "12.5{Enter}");
  expect(kind).toBeDisabled();
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { items: { kind: "literal", itemKind: "number", items: [12.5] } },
    }),
  );
});

it("offers only an eligible Search Records collection and allows returning to a literal", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  await user.click(screen.getByRole("combobox", { name: "List source" }));
  expect(screen.queryByRole("option", { name: /Other records/ })).toBeNull();
  await user.click(screen.getByRole("option", { name: /All records · Find contacts/ }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { items: { kind: "reference", nodeId: "search", path: ["all"] } },
    }),
  );
  expect(screen.getByText(/All records · Find contacts/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Remove mapping" }));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ config: nodeConfig }));
});

it("defaults to stopping on failure and writes the switch without changing the list", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  const toggle = screen.getByRole("switch", { name: "Continue on iteration failure" });
  expect(toggle).not.toBeChecked();
  await user.click(toggle);
  expect(toggle).toBeChecked();
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: { ...nodeConfig, shouldContinueOnIterationFailure: true },
    }),
  );
});

it("stops appending at the runtime limit and preserves read-only settings", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const config = {
    items: {
      kind: "literal",
      itemKind: "number",
      items: Array.from({ length: workflowIteratorMaxItems }, (_, index) => index),
    },
    shouldContinueOnIterationFailure: true,
  };
  const { unmount } = render(<Harness onChange={onChange} config={config} />);
  await user.click(screen.getByRole("button", { name: "Items to iterate over" }));
  expect(screen.getByRole("button", { name: "Add item" })).toBeDisabled();
  expect(onChange).not.toHaveBeenCalled();
  unmount();
  render(<Harness onChange={onChange} config={config} editable={false} />);
  await user.click(screen.getByRole("button", { name: "Items to iterate over" }));
  const readOnly = within(screen.getByRole("dialog", { name: "Items to iterate over" }));
  expect(readOnly.getAllByRole("listitem")).toHaveLength(workflowIteratorMaxItems);
  expect(readOnly.queryByRole("button", { name: "Add item" })).toBeNull();
  expect(screen.getByRole("switch", { name: "Continue on iteration failure" })).toBeDisabled();
  expect(screen.queryByRole("combobox", { name: "List source" })).toBeNull();
});
