import { expect, it } from "vitest";
import { appendConnectedNode } from "./connectionGestures";
import { validateDefinition } from "./definition";
import { initialDefinition } from "./editorModel";
import { makeNode } from "./nodeFactory";
import { definitionSchema, type WorkflowDefinition } from "./schemas";

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
    layout: { start: { x: 20, y: 40 }, read: { x: 20, y: 300 }, task: { x: 20, y: 560 } },
  };
}

it("inserts a linear Wait between occupied manual.next and read without changing existing steps", () => {
  const graph = sample();
  const before = structuredClone(graph);
  const wait = makeNode(graph, "delay", "wait", "Wait", "Follow up", "start");
  const position = { x: 20, y: 170 };
  expect(validateDefinition(graph).ok).toBe(true);

  const result = appendConnectedNode(graph, wait, position, { from: "start", port: "next" });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Insertion failed: ${result.error}`);
  expect(result.value).not.toBe(graph);
  expect(result.value.nodes).toHaveLength(graph.nodes.length + 1);
  expect(result.value.nodes.find((node) => node.id === wait.id)).toBe(wait);
  for (const node of graph.nodes) {
    expect(result.value.nodes.find((item) => item.id === node.id)).toBe(node);
  }
  expect(result.value.edges).toHaveLength(3);
  expect(result.value.edges).toEqual(
    expect.arrayContaining([
      { from: "start", to: "wait", port: "next" },
      { from: "wait", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ]),
  );
  expect(result.value.layout).toEqual({ ...graph.layout, wait: position });
  expect(validateDefinition(result.value).ok).toBe(true);
  expect(graph).toEqual(before);
});

it("inserts on an occupied true branch while preserving the false port and its task", () => {
  const original = sample();
  const condition = makeNode(original, "condition", "check", "Check status", "Follow up", "read");
  const falseTask = makeNode(
    original,
    "activity.create",
    "falseTask",
    "Review later",
    "Review",
    "read",
  );
  const graph: WorkflowDefinition = {
    ...original,
    nodes: [...original.nodes, condition, falseTask],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "check", port: "next" },
      { from: "check", to: "task", port: "true" },
      { from: "check", to: "falseTask", port: "false" },
    ],
    layout: { ...original.layout, check: { x: 20, y: 430 }, falseTask: { x: 380, y: 690 } },
  };
  const before = structuredClone(graph);
  const wait = makeNode(graph, "delay", "wait", "Wait", "Follow up", "check");
  const position = { x: -160, y: 560 };
  expect(validateDefinition(graph).ok).toBe(true);

  const result = appendConnectedNode(graph, wait, position, { from: "check", port: "true" });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Branch insertion failed: ${result.error}`);
  expect(result.value.edges).toHaveLength(5);
  expect(result.value.edges).toEqual(
    expect.arrayContaining([
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "check", port: "next" },
      { from: "check", to: "wait", port: "true" },
      { from: "wait", to: "task", port: "next" },
      { from: "check", to: "falseTask", port: "false" },
    ]),
  );
  expect(result.value.nodes).toHaveLength(6);
  for (const node of graph.nodes) {
    expect(result.value.nodes.find((item) => item.id === node.id)).toBe(node);
  }
  expect(result.value.layout).toEqual({ ...graph.layout, wait: position });
  expect(validateDefinition(result.value).ok).toBe(true);
  expect(graph).toEqual(before);
});

it("returns the real downstream occupiedInput failure without partially changing an ambiguous draft", () => {
  const original = sample();
  const other = makeNode(original, "activity.create", "other", "Other task", "Review");
  // A schema-shaped but invalid loaded draft already has another incoming link to read.
  // Replacing start.next permits the first link; wait.next must still reject that input.
  const graph: WorkflowDefinition = {
    ...original,
    nodes: [...original.nodes, other],
    edges: [...original.edges, { from: "other", to: "read", port: "next" }],
    layout: { ...original.layout, other: { x: 380, y: 40 } },
  };
  const before = structuredClone(graph);
  const wait = makeNode(graph, "delay", "wait", "Wait", "Follow up", "start");
  expect(definitionSchema.safeParse(graph).success).toBe(true);
  expect(validateDefinition(graph).ok).toBe(false);

  const result = appendConnectedNode(
    graph,
    wait,
    { x: 20, y: 170 },
    { from: "start", port: "next" },
  );

  expect(result).toEqual({ ok: false, error: "occupiedInput" });
  expect(graph).toEqual(before);
  expect(graph.nodes.some((node) => node.id === wait.id)).toBe(false);
  expect(graph.edges).toContainEqual({ from: "start", to: "read", port: "next" });
  expect(graph.layout).not.toHaveProperty(wait.id);
});

it("rejects ambiguous Condition insertion while keeping free-output Condition addition supported", () => {
  const graph = sample();
  const before = structuredClone(graph);
  const condition = makeNode(graph, "condition", "check", "Condition", "Follow up", "read");
  const position = { x: 20, y: 820 };

  const occupied = appendConnectedNode(graph, condition, position, { from: "start", port: "next" });
  expect(occupied.ok).toBe(false);
  expect(graph).toEqual(before);

  const free = appendConnectedNode(graph, condition, position, { from: "task", port: "next" });
  expect(free.ok).toBe(true);
  if (!free.ok) throw new Error(`Free-output addition failed: ${free.error}`);
  expect(free.value.nodes).toHaveLength(4);
  expect(free.value.nodes.find((node) => node.id === condition.id)).toBe(condition);
  expect(free.value.edges).toEqual([...graph.edges, { from: "task", to: "check", port: "next" }]);
  expect(free.value.layout).toEqual({ ...graph.layout, check: position });
  expect(graph).toEqual(before);
});
