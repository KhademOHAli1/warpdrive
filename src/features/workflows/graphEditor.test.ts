import { expect, it } from "vitest";
import { initialDefinition } from "./editorModel";
import { connectNodes, disconnectNodes, insertNode, moveNode, removeNode } from "./graphEditor";
import { arrangeGraph, positionFor } from "./nodeLayout";
import { definitionSchema } from "./schemas";

function sample() {
  return initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" });
}
it("arranges compact steps with the reference 150px vertical spacing", () => {
  expect(arrangeGraph(sample()).layout?.task?.y).toBe(300);
});
it("adds a disconnected node without changing existing connections", () => {
  const original = sample();
  const edited = insertNode(
    original,
    {
      id: "nextTask",
      type: "activity.create",
      version: 1,
      name: "Next",
      config: { subject: { kind: "value", value: "Call" } },
    },
    { x: 360, y: 300 },
  );
  expect(edited.edges).toEqual(original.edges);
  expect(edited.nodes).toHaveLength(4);
  expect(edited.layout?.nextTask).toEqual({ x: 360, y: 300 });
});
it("connects and reconnects by port without relying on node-array order", () => {
  let graph = sample();
  graph = insertNode(graph, { ...graph.nodes[2]!, id: "other" }, { x: 360, y: 300 });
  const linked = connectNodes(graph, { from: "task", to: "other", port: "next" });
  expect(linked.ok).toBe(true);
  const reconnected = connectNodes(
    graph,
    { from: "read", to: "other", port: "next" },
    graph.edges[1],
  );
  expect(reconnected.ok).toBe(true);
  if (reconnected.ok)
    expect(reconnected.value.edges).toContainEqual({ from: "read", to: "other", port: "next" });
});
it("rejects cycles, duplicate output ports, multiple incoming links, and trigger targets", () => {
  const graph = sample();
  expect(connectNodes(graph, { from: "task", to: "start", port: "next" }).ok).toBe(false);
  expect(connectNodes(graph, { from: "read", to: "task", port: "next" }).ok).toBe(false);
  expect(connectNodes(graph, { from: "start", to: "task", port: "next" }).ok).toBe(false);
  const open = disconnectNodes(graph, graph.edges[0]!);
  expect(connectNodes(open, { from: "task", to: "read", port: "next" }).ok).toBe(false);
});
it("preserves unrelated edges on deletion and persists finite layout positions", () => {
  const original = sample();
  const moved = moveNode(original, "task", { x: 420, y: 150 });
  expect(definitionSchema.safeParse(moved).success).toBe(true);
  expect(
    definitionSchema.safeParse({ ...moved, layout: { task: { x: Infinity, y: 0 } } }).success,
  ).toBe(false);
  const removed = removeNode(moved, "read");
  expect(removed.edges).toEqual([]);
  expect(removed.nodes.map((node) => node.id)).toEqual(["start", "task"]);
  expect(removeNode(original, "start")).toEqual(original);
});

it("keeps implicit centers stable when the first edit materializes their layout and survives JSON parsing", () => {
  const original = sample();
  const before = structuredClone(original);
  const moved = moveNode(original, "task", { x: 420, y: 450 });
  expect(moved.layout).toEqual({
    start: { x: 0, y: 0, anchor: "center" },
    read: { x: 0, y: 150, anchor: "center" },
    task: { x: 420, y: 450, anchor: "center" },
  });
  const restored = definitionSchema.parse(JSON.parse(JSON.stringify(moved)));
  expect(restored.layout).toEqual(moved.layout);
  expect(positionFor(restored, "read")).toEqual(positionFor(original, "read"));
  expect(original).toEqual(before);
});

it("preserves mixed legacy and centered anchors through insertion, dragging and removal", () => {
  const original = sample();
  original.layout = { start: { x: 17, y: 9 }, read: { x: 100, y: 200, anchor: "center" } };
  const legacy = original.layout.start;
  const inserted = insertNode(
    original,
    { ...original.nodes[2]!, id: "extra" },
    { x: 420, y: 600, anchor: "center" },
  );
  const movedLegacy = moveNode(inserted, "start", { x: 27, y: 19 });
  expect(movedLegacy.layout?.start).toEqual({ x: 27, y: 19 });
  const movedCenter = moveNode(movedLegacy, "read", { x: 200, y: 350 });
  expect(movedCenter.layout?.read).toEqual({ x: 200, y: 350, anchor: "center" });
  const removed = removeNode(movedCenter, "extra");
  expect(removed.layout?.task).toEqual({ x: 0, y: 300, anchor: "center" });
  expect(removed.layout?.read).toEqual(movedCenter.layout?.read);
  expect(original.layout.start).toBe(legacy);
  expect(original.layout.start).toEqual({ x: 17, y: 9 });
  expect(definitionSchema.parse(JSON.parse(JSON.stringify(removed))).layout).toEqual(
    removed.layout,
  );
  expect(
    definitionSchema.safeParse({
      ...removed,
      layout: { read: { x: 0, y: 0, anchor: "top-right" } },
    }).success,
  ).toBe(false);
});
