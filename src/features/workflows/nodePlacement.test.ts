import { expect, it } from "vitest";
import { appendConnectedNode } from "./connectionGestures";
import { initialDefinition } from "./editorModel";
import { makeNode } from "./nodeFactory";
import { currentLayout, positionFor, positionForNewNode } from "./nodeLayout";
import type { NodePosition, WorkflowDefinition } from "./schemas";

function sample(): WorkflowDefinition {
  return initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" });
}

function expectClear(graph: WorkflowDefinition, position: NodePosition) {
  // Keep the editor's existing 360 by 260 layout cell clear, including long card content.
  for (const node of graph.nodes) {
    const existing = positionFor(graph, node.id);
    expect(
      Math.abs(position.x - existing.x) >= 360 || Math.abs(position.y - existing.y) >= 260,
      `New position must leave the existing ${node.id} card clear`,
    ).toBe(true);
  }
}

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
