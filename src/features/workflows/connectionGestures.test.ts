import { expect, it } from "vitest";
import { appendConnectedNode, drawConnection } from "./connectionGestures";
import { initialDefinition } from "./editorModel";
import { insertNode } from "./graphEditor";

const sample = () =>
  initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" });
it("treats redrawing the existing connection as a no-op", () => {
  const graph = sample();
  const result = drawConnection(graph, graph.edges[0]!);
  expect(result.ok && result.value === graph).toBe(true);
});
it("moves an occupied output atomically while preserving the old graph", () => {
  const original = sample();
  const extra = { ...original.nodes[2]!, id: "extra" };
  const graph = insertNode(original, extra, { x: 360, y: 300 });
  const moved = drawConnection(graph, { from: "read", to: "extra", port: "next" });
  expect(moved.ok).toBe(true);
  if (moved.ok) {
    expect(moved.value.edges).toContainEqual({ from: "read", to: "extra", port: "next" });
    expect(moved.value.edges).not.toContainEqual(graph.edges[1]);
  }
  expect(graph.edges).toEqual(original.edges);
  expect(drawConnection(graph, { from: "task", to: "read", port: "next" })).toEqual({
    ok: false,
    error: "occupiedInput",
  });
  expect(graph.edges).toEqual(original.edges);
});
it("does not steal another output when reconnecting the source endpoint", () => {
  const graph = sample();
  expect(
    drawConnection(graph, { from: "start", to: "task", port: "next" }, graph.edges[1]),
  ).toEqual({ ok: false, error: "occupiedOutput" });
});
it("creates a connected step in one edit and refuses an occupied branch without orphaning it", () => {
  const graph = sample();
  const node = { ...graph.nodes[2]!, id: "extra" };
  const added = appendConnectedNode(graph, node, { x: 0, y: 600 }, { from: "task", port: "next" });
  expect(added.ok).toBe(true);
  if (added.ok) {
    expect(added.value.nodes).toHaveLength(4);
    expect(added.value.edges).toContainEqual({ from: "task", to: "extra", port: "next" });
  }
  expect(
    appendConnectedNode(graph, node, { x: 0, y: 600 }, { from: "read", port: "next" }),
  ).toEqual({ ok: false, error: "occupiedOutput" });
  expect(graph.nodes).toHaveLength(3);
});
