import { expect, it } from "vitest";
import { appendConnectedNode } from "./connectionGestures";
import { initialDefinition } from "./editorModel";
import { branchPort, newIfElseBranch, newIfElseConfig } from "./ifElse";
import { makeNode } from "./nodeFactory";
import { arrangeGraph, currentLayout, positionFor, positionForNewNode } from "./nodeLayout";
import type { NodePosition, WorkflowDefinition } from "./schemas";

function sample(): WorkflowDefinition {
  return initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" });
}

it("places new ordered routes on separate 120px branches and keeps existing positions intact", () => {
  const graph = sample();
  const config = newIfElseConfig();
  graph.nodes.push({ id: "switch", type: "ifElse", name: "If/Else", version: 1, config });
  graph.layout = { switch: { x: 100, y: 200, anchor: "center" } };
  const position = (id: string) =>
    positionForNewNode(graph, "switch", { from: "switch", port: branchPort(id) });
  expect(position("if")).toEqual({ x: -100, y: 320, anchor: "center" });
  expect(position("else")).toEqual({ x: 300, y: 320, anchor: "center" });
  config.branches.push(newIfElseBranch("middle"));
  expect(position("middle")).toEqual({ x: 100, y: 320, anchor: "center" });
  expect(graph.layout.switch).toEqual({ x: 100, y: 200, anchor: "center" });
});

function expectClear(graph: WorkflowDefinition, position: NodePosition) {
  // Keep compact workflow cards and their trailing add controls clear of neighboring cells.
  for (const node of graph.nodes) {
    const existing = positionFor(graph, node.id);
    expect(
      Math.abs(position.x - existing.x) >= 360 || Math.abs(position.y - existing.y) >= 150,
      `New position must leave the existing ${node.id} card clear`,
    ).toBe(true);
  }
}

it("spaces implicit steps and explicit Arrange output by the reference 150px", () => {
  const graph = sample();
  expect(positionFor(graph, "read").y - positionFor(graph, "start").y).toBe(150);
  const arranged = arrangeGraph(graph);
  const positions = arranged.layout;
  if (positions?.read === undefined || positions.start === undefined)
    throw new Error("Arrange must position both connected steps");
  expect(positions.read.y - positions.start.y).toBe(150);
  expect(positionFor(graph, "read")).toEqual({ x: 0, y: 150, anchor: "center" });
  expect(positions.read.anchor).toBe("center");
  expect(graph.layout).toBeUndefined();
  expect(positionForNewNode(graph, "task", { from: "task", port: "next" }).y).toBe(450);
});

it("uses measured source and destination centers when inserting between mixed legacy and centered steps", () => {
  const graph: WorkflowDefinition = {
    ...sample(),
    layout: {
      start: { x: 0, y: 100 },
      read: { x: 100, y: 700, anchor: "center" },
      task: { x: 1000, y: 1200 },
    },
  };
  const before = structuredClone(graph);
  const measurements = new Map([["start", { width: 200, height: 44 }]]);
  expect(positionForNewNode(graph, "start", { from: "start", port: "next" }, measurements)).toEqual(
    {
      x: 100,
      y: 411,
      anchor: "center",
    },
  );
  expect(graph).toEqual(before);
});

it("retains an unmeasured legacy source anchor instead of guessing its intrinsic dimensions", () => {
  const graph: WorkflowDefinition = {
    ...sample(),
    layout: { task: { x: -201, y: 712 } },
  };
  expect(positionForNewNode(graph, "task", { from: "task", port: "next" })).toEqual({
    x: -201,
    y: 862,
  });
  expect(
    positionForNewNode(
      graph,
      "task",
      { from: "task", port: "next" },
      new Map([["task", { width: 180, height: 44 }]]),
    ),
  ).toEqual({
    x: -111,
    y: 884,
    anchor: "center",
  });
});

it.each([
  { width: 0, height: 44 },
  { width: 180, height: 0 },
  { width: Number.NaN, height: 44 },
])("does not use an unsettled legacy measurement %s as a center", (dimensions) => {
  const graph = sample();
  graph.layout = { task: { x: 20, y: 400 } };
  expect(
    positionForNewNode(
      graph,
      "task",
      { from: "task", port: "next" },
      new Map([["task", dimensions]]),
    ),
  ).toEqual({ x: 20, y: 550 });
});

it("bounds a new center position without rewriting a legacy source at the coordinate limit", () => {
  const graph = sample();
  graph.layout = { task: { x: 99990, y: 99990 } };
  const position = positionForNewNode(
    graph,
    "task",
    { from: "task", port: "next" },
    new Map([["task", { width: 180, height: 44 }]]),
  );
  expect(position).toEqual({ x: 100000, y: 100000, anchor: "center" });
  expect(graph.layout.task).toEqual({ x: 99990, y: 99990 });
});

it("retains every explicit stored position when reading or suggesting a new insertion", () => {
  const graph = {
    ...sample(),
    layout: { start: { x: 17, y: 9 }, read: { x: 311, y: 407 }, task: { x: -201, y: 712 } },
  };
  const before = structuredClone(graph);
  expect(currentLayout(graph)).toEqual(graph.layout);
  positionForNewNode(graph, "read", { from: "read", port: "next" });
  expect(graph).toEqual(before);
});

it("leaves space for existing cards when inserting into the standard connected layout", () => {
  const graph = sample();
  const before = structuredClone(graph);
  expectClear(graph, positionForNewNode(graph, "start", { from: "start", port: "next" }));
  expect(graph).toEqual(before);
});

it("avoids an occupied neighboring column without moving any existing node", () => {
  const original = sample();
  const graph = { ...original, layout: { ...currentLayout(original), task: { x: 360, y: 130 } } };
  const before = structuredClone(graph);
  expectClear(graph, positionForNewNode(graph, "start", { from: "start", port: "next" }));
  expect(graph).toEqual(before);
});

it("keeps repeated insertion clear instead of halving the remaining vertical space", () => {
  const graph = sample();
  const output = { from: "start", port: "next" } as const;
  const wait = makeNode(graph, "delay", "wait", "Wait", "Call", "start");
  const first = appendConnectedNode(
    graph,
    wait,
    positionForNewNode(graph, "start", output),
    output,
  );
  expect(first.ok).toBe(true);
  if (!first.ok) throw new Error(`Initial insertion failed: ${first.error}`);
  const before = structuredClone(first.value);
  expectClear(first.value, positionForNewNode(first.value, "start", output));
  expect(first.value).toEqual(before);
});

it.each([-100000, 100000])(
  "keeps default insertion positions within graph bounds near x=%s",
  (x) => {
    const original = sample();
    const graph = {
      ...original,
      layout: { start: { x, y: 0 }, read: { x, y: 260 }, task: { x, y: 520 } },
    };
    const position = positionForNewNode(graph, "start", { from: "start", port: "next" });
    expect(position.x).toBeGreaterThanOrEqual(-100000);
    expect(position.x).toBeLessThanOrEqual(100000);
    expect(position.y).toBeGreaterThanOrEqual(-100000);
    expect(position.y).toBeLessThanOrEqual(100000);
  },
);
