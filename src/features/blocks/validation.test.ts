import { expect, it } from "vitest";
import type { WorkflowV2Definition, WorkflowV2Node } from "./contracts";
import { validateWorkflowV2 } from "./validation";

const node = (id: string, config: WorkflowV2Node["config"] = {}): WorkflowV2Node => ({
  id,
  type: "CODE",
  name: id,
  version: 1,
  config,
});
const graph = (nodes: WorkflowV2Node[]): WorkflowV2Definition => ({
  schemaVersion: 2,
  trigger: { type: "manual", config: {} },
  nodes,
  entryNodeIds: ["a"],
  edges: [{ id: "ab", source: "a", target: "b", sourcePort: "next" }],
});
it("accepts ancestor references and rejects sibling or future references", () => {
  expect(
    validateWorkflowV2(
      graph([
        node("a"),
        node("b", { inputs: { id: { kind: "reference", nodeId: "a", path: ["id"] } } }),
      ]),
    ).ok,
  ).toBe(true);
  expect(
    validateWorkflowV2(
      graph([
        node("a", { inputs: { id: { kind: "reference", nodeId: "b", path: ["id"] } } }),
        node("b"),
      ]),
    ).ok,
  ).toBe(false);
});
it("rejects cycles, unreachable blocks, duplicate edges and implicit joins", () => {
  const definition = graph([node("a"), node("b")]);
  expect(
    validateWorkflowV2({
      ...definition,
      edges: [...definition.edges, { id: "ba", source: "b", target: "a", sourcePort: "next" }],
    }).ok,
  ).toBe(false);
  expect(validateWorkflowV2(graph([node("a"), node("b"), node("unused")])).ok).toBe(false);
  expect(
    validateWorkflowV2({ ...definition, edges: [...definition.edges, ...definition.edges] }).ok,
  ).toBe(false);
});
it("bounds deep configs before recursive schema parsing", () => {
  let value: WorkflowV2Node["config"] = {};
  for (let i = 0; i < 40; i++) value = { nested: value };
  expect(validateWorkflowV2(graph([node("a", value), node("b")])).ok).toBe(false);
});
it("requires an iterator body and named branch ports", () => {
  const loop = { ...node("a"), type: "ITERATOR" as const, config: { items: [] } };
  expect(validateWorkflowV2(graph([loop, node("b")])).ok).toBe(false);
  const branch = { ...node("a"), type: "IF_ELSE" as const, config: { branches: [{ id: "yes" }] } };
  expect(
    validateWorkflowV2({
      ...graph([branch, node("b")]),
      edges: [{ id: "yes", source: "a", target: "b", sourcePort: "yes" }],
    }).ok,
  ).toBe(true);
});

it("persists a moved trigger without accepting it as a step ID", () => {
  const moved = {
    ...graph([
      node("a"),
      node("b", { inputs: { id: { kind: "reference", nodeId: "$trigger", path: ["recordId"] } } }),
    ]),
    layout: { $trigger: { x: 15, y: 30 }, a: { x: 120, y: 30 } },
  };
  expect(validateWorkflowV2(moved)).toMatchObject({ ok: true, value: { layout: moved.layout } });
  expect(validateWorkflowV2({ ...moved, nodes: [node("$trigger"), node("b")] }).ok).toBe(false);
});
