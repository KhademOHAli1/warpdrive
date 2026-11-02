// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { appendConnectedNode } from "../connectionGestures";
import { initialDefinition } from "../editorModel";
import type { WorkflowDefinition, WorkflowNode } from "../schemas";
import { BindingField } from "./BindingField";
import { ConnectionEditor } from "./ConnectionEditor";
import { EdgeInspector } from "./EdgeInspector";

afterEach(cleanup);

function insertedWaitFixture() {
  const initial = initialDefinition({
    start: "Manual start",
    read: "Read deal",
    task: "Create task",
    subject: "Follow up",
  });
  const original: WorkflowDefinition = {
    ...initial,
    nodes: initial.nodes.map((node) =>
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
  const before = structuredClone(original);
  const wait: WorkflowNode = {
    id: "wait",
    type: "delay",
    version: 1,
    name: "Wait",
    nameMode: "automatic",
    config: { minutes: { kind: "value", value: 1 } },
  };
  const inserted = appendConnectedNode(
    original,
    wait,
    { x: 360, y: 130 },
    { from: "start", port: "next" },
  );
  if (!inserted.ok) throw new Error("Existing Wait insertion failed before ordinal rendering");
  expect(original).toEqual(before);
  expect(inserted.value.nodes.map((node) => node.id)).toEqual(["start", "read", "task", "wait"]);
  expect(inserted.value.edges).toEqual(
    expect.arrayContaining([
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ]),
  );
  return inserted.value;
}

function nodeById(definition: WorkflowDefinition, id: string) {
  const node = definition.nodes.find((item) => item.id === id);
  if (node === undefined) throw new Error(`Ordinal fixture node ${id} is missing`);
  return node;
}

it("shows the read step's connection-order ordinal in a task binding after Wait insertion", () => {
  const definition = insertedWaitFixture();
  const before = structuredClone(definition);
  const task = nodeById(definition, "task");
  const onChange = vi.fn();
  render(
    <LocaleProvider locale="en">
      <BindingField
        definition={definition}
        nodeId={task.id}
        value={task.config.subject}
        onChange={onChange}
        kind="text"
        label="Task title"
        sourceLabel="Use as the task title"
        editable
      />
    </LocaleProvider>,
  );
  expect(definition).toEqual(before);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Use as the task title" })).toHaveTextContent(
    "Deal title · Read deal 3",
  );
});

it("shows the inserted Wait's connection-order ordinal in the predecessor's Connections selector", () => {
  const definition = insertedWaitFixture();
  const before = structuredClone(definition);
  const onChange = vi.fn();
  const onProblem = vi.fn();
  render(
    <LocaleProvider locale="en">
      <ConnectionEditor
        definition={definition}
        node={nodeById(definition, "start")}
        editable
        onChange={onChange}
        onProblem={onProblem}
      />
    </LocaleProvider>,
  );
  expect(definition).toEqual(before);
  expect(onChange).not.toHaveBeenCalled();
  expect(onProblem).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Next step" })).toHaveTextContent("Wait · 2");
});

it("shows connection-order source and target ordinals in EdgeInspector after Wait insertion", () => {
  const definition = insertedWaitFixture();
  const before = structuredClone(definition);
  const onChange = vi.fn();
  const onProblem = vi.fn();
  const onClose = vi.fn();
  render(
    <LocaleProvider locale="en">
      <EdgeInspector
        definition={definition}
        edge={{ from: "read", to: "task", port: "next" }}
        editable
        onChange={onChange}
        onProblem={onProblem}
        onClose={onClose}
      />
    </LocaleProvider>,
  );
  expect(definition).toEqual(before);
  expect(onChange).not.toHaveBeenCalled();
  expect(onProblem).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect([
    screen.getByRole("combobox", { name: "Source node" }).textContent?.trim(),
    screen.getByRole("combobox", { name: "Destination node" }).textContent?.trim(),
  ]).toEqual(["Read deal · 3", "Create task · 4"]);
});
