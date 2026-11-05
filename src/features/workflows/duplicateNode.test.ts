import { assert, expect, it } from "vitest";
import { duplicateNode } from "./duplicateNode";
import { initialDefinition } from "./editorModel";
import { displayNodeName } from "./nodeNames";
import { definitionSchema, type WorkflowDefinition } from "./schemas";

function sample() {
  return initialDefinition({
    start: "Manual start",
    read: "Read deal",
    task: "Create task",
    subject: "Call the buyer",
  });
}

it("duplicates only the selected action with its configuration and no new connections", () => {
  const graph = sample();
  graph.layout = { task: { x: 100, y: 200 } };
  const before = structuredClone(graph);
  const changed = duplicateNode(graph, "task", "node_copy");
  assert(changed.ok);
  const copy = changed.value.nodes.at(-1);
  assert(copy !== undefined);
  const source = graph.nodes.find((node) => node.id === "task");
  assert(source !== undefined);
  expect(copy).toEqual({
    ...source,
    id: "node_copy",
    name: "Create task (Duplicate)",
    nameMode: "custom",
  });
  expect(copy.config).not.toBe(source.config);
  expect(copy.config.dealId).not.toBe(source.config.dealId);
  expect(changed.value.edges).toBe(graph.edges);
  expect(changed.value.edges.some((edge) => edge.from === copy.id || edge.to === copy.id)).toBe(
    false,
  );
  expect(changed.value.layout).toEqual({ task: { x: 100, y: 200 }, node_copy: { x: 150, y: 250 } });
  expect(changed.value.layout?.task).toBe(graph.layout.task);
  expect(changed.value.nodes.slice(0, -1)).toEqual(graph.nodes);
  copy.config.subject = { kind: "value", value: "Edited copy" };
  expect(graph).toEqual(before);
});

it("keeps a duplicated condition disconnected from both original branches", () => {
  const initial = sample();
  const graph: WorkflowDefinition = {
    ...initial,
    nodes: [
      ...initial.nodes,
      {
        id: "check",
        type: "condition",
        version: 1,
        name: "Check buyer",
        nameMode: "custom",
        config: { expression: { kind: "group", id: "group", operator: "and", children: [] } },
      },
    ],
    edges: [
      { from: "start", to: "check", port: "next" },
      { from: "check", to: "read", port: "true" },
      { from: "check", to: "task", port: "false" },
    ],
  };
  const before = structuredClone(graph);
  const changed = duplicateNode(graph, "check", "check_copy");
  assert(changed.ok);
  expect(changed.value.edges).toEqual(before.edges);
  expect(changed.value.nodes).toHaveLength(graph.nodes.length + 1);
  expect(changed.value.nodes.at(-1)?.config).toEqual(graph.nodes.at(-1)?.config);
  expect(changed.value.nodes.at(-1)?.config).not.toBe(graph.nodes.at(-1)?.config);
  expect(graph).toEqual(before);
});

it("keeps the duplicate suffix visible for automatically named actions in another interface language", () => {
  const changed = duplicateNode(sample(), "read", "read_copy");
  assert(changed.ok);
  const copy = changed.value.nodes.at(-1);
  assert(copy !== undefined);
  expect(copy.nameMode).toBe("custom");
  expect(displayNodeName(copy, "de")).toBe("Read deal (Duplicate)");
  expect(changed.value.layout).toEqual({ read_copy: { x: 50, y: 200, anchor: "center" } });
});

it("preserves centered clone coordinates through the schema while keeping legacy neighbors untouched", () => {
  const graph = sample();
  graph.layout = { start: { x: 17, y: 9 }, read: { x: 100, y: 200, anchor: "center" } };
  const before = structuredClone(graph);
  const changed = duplicateNode(graph, "read", "read_copy");
  assert(changed.ok);
  expect(changed.value.layout?.read_copy).toEqual({ x: 150, y: 250, anchor: "center" });
  expect(changed.value.layout?.start).toBe(graph.layout.start);
  expect(definitionSchema.parse(JSON.parse(JSON.stringify(changed.value))).layout).toEqual(
    changed.value.layout,
  );
  expect(graph).toEqual(before);
});

it("bounds a long duplicate name and layout to the existing draft schema", () => {
  const graph = sample();
  graph.nodes[1] = { ...graph.nodes[1]!, name: "A".repeat(120), nameMode: "custom" };
  graph.layout = { read: { x: 99980, y: 99990 } };
  const changed = duplicateNode(graph, "read", "read_copy");
  assert(changed.ok);
  expect(changed.value.nodes.at(-1)?.name).toHaveLength(120);
  expect(changed.value.nodes.at(-1)?.name.endsWith(" (Duplicate)")).toBe(true);
  expect(changed.value.layout?.read_copy).toEqual({ x: 100000, y: 100000 });
  expect(definitionSchema.safeParse(changed.value).success).toBe(true);
});

it.each([
  { source: "absent", id: "node_copy", error: "missingNode" },
  { source: "start", id: "node_copy", error: "triggerNode" },
  { source: "task", id: "read", error: "duplicateId" },
  { source: "task", id: "1_invalid", error: "invalidId" },
])("refuses $error without modifying the draft", ({ source, id, error }) => {
  const graph = sample();
  const before = structuredClone(graph);
  expect(duplicateNode(graph, source, id)).toEqual({ ok: false, error });
  expect(graph).toEqual(before);
});

it("preserves the 100-node limit without creating or connecting a copy", () => {
  const graph = sample();
  const action = graph.nodes[2]!;
  graph.nodes.push(
    ...Array.from({ length: 97 }, (_, index) => ({ ...action, id: `other_${index}` })),
  );
  const before = structuredClone(graph);
  expect(duplicateNode(graph, "task", "node_copy")).toEqual({ ok: false, error: "nodeLimit" });
  expect(graph).toEqual(before);
});
