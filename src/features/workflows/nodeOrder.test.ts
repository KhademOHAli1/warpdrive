import { expect, it } from "vitest";
import { initialDefinition } from "./editorModel";
import { makeNode } from "./nodeFactory";
import { currentLayout } from "./nodeLayout";
import { orderedWorkflowNodes } from "./nodeOrder";
import type { WorkflowDefinition, WorkflowEdge } from "./schemas";

function edge(from: string, to: string, port: WorkflowEdge["port"] = "next"): WorkflowEdge {
  return { from, to, port };
}

function graph(ids: string[], edges: WorkflowEdge[]): WorkflowDefinition {
  const base = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Follow up",
  });
  return {
    ...base,
    nodes: ids.map(
      (id) =>
        base.nodes.find((node) => node.id === id) ??
        makeNode(
          base,
          id === "condition" ? "condition" : id === "wait" ? "delay" : "record.read",
          id,
          id,
          "Follow up",
        ),
    ),
    edges,
    layout: currentLayout(base),
  };
}

function expectOrder(definition: WorkflowDefinition, ids: string[]) {
  const before = structuredClone(definition);
  Object.freeze(definition.nodes);
  Object.freeze(definition.edges);
  const result = orderedWorkflowNodes(definition);
  expect(result.map((node) => node.id)).toEqual(ids);
  expect(result).toHaveLength(definition.nodes.length);
  for (const node of definition.nodes) expect(result).toContain(node);
  expect(definition).toEqual(before);
  return result;
}

it("orders the inserted linear path without reordering stored nodes or replacing node objects", () => {
  const definition = graph(
    ["start", "read", "task", "wait"],
    [edge("start", "wait"), edge("wait", "read"), edge("read", "task")],
  );
  expectOrder(definition, ["start", "wait", "read", "task"]);
});

it.each([false, true])(
  "preserves creation priority among eligible branches, reversed edges=%s",
  (reverse) => {
    const edges = [
      edge("start", "condition"),
      edge("condition", "b", "false"),
      edge("condition", "a", "true"),
    ];
    const definition = graph(
      ["b", "a", "condition", "start"],
      reverse ? edges.toReversed() : edges,
    );
    expectOrder(definition, ["start", "condition", "b", "a"]);
  },
);

it("ignores missing endpoints while retaining disconnected nodes and known dependencies", () => {
  const definition = graph(
    ["task", "read", "start", "detached"],
    [
      edge("start", "read"),
      edge("read", "task"),
      edge("missing", "detached"),
      edge("task", "missing"),
    ],
  );
  expectOrder(definition, ["start", "read", "task", "detached"]);
});

it("retains an unresolved cycle in original order after the acyclic prefix", () => {
  const definition = graph(
    ["b", "a", "read", "start"],
    [edge("start", "read"), edge("read", "a"), edge("a", "b"), edge("b", "a")],
  );
  expectOrder(definition, ["start", "read", "b", "a"]);
});

it("keeps a self-loop visible without blocking an independent valid path", () => {
  const definition = graph(
    ["self", "read", "start"],
    [edge("self", "self"), edge("start", "read")],
  );
  expectOrder(definition, ["start", "read", "self"]);
});

it("retains every duplicate-id draft entry in the original array", () => {
  const definition = graph(["start", "read", "read"], [edge("start", "read")]);
  expect(expectOrder(definition, ["start", "read", "read"])).toBe(definition.nodes);
});

it("preserves an already ordered workflow", () => {
  const definition = graph(
    ["start", "read", "task"],
    [edge("start", "read"), edge("read", "task")],
  );
  expectOrder(definition, ["start", "read", "task"]);
});
