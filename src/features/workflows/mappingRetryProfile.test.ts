import { expect, it } from "vitest";
import { validateDefinition } from "./definition";
import { initialDefinition } from "./editorModel";
import { retryableTaskDefinition } from "./runRetryProfile";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

function comparison(left: WorkflowNode["config"][string], right: WorkflowNode["config"][string]) {
  const graph = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Follow up",
  });
  graph.nodes.push(
    {
      id: "compare",
      type: "condition",
      version: 1,
      name: "Compare",
      config: { left, operator: "equals", right },
    },
    {
      id: "end",
      type: "delay",
      version: 1,
      name: "End",
      config: { minutes: { kind: "value", value: 1 } },
    },
  );
  graph.edges = [
    { from: "start", to: "read", port: "next" },
    { from: "read", to: "compare", port: "next" },
    { from: "compare", to: "task", port: "true" },
    { from: "compare", to: "end", port: "false" },
  ];
  return graph;
}

it("preserves eligibility for the existing minimal literal comparison profile", () => {
  const graph = comparison({ kind: "value", value: 0 }, { kind: "value", value: 0 });
  expect(validateDefinition(graph, { status: "complete", defs: [] }).ok).toBe(true);
  expect(retryableTaskDefinition(graph)).toStrictEqual(graph);
});

it.each([
  [
    { kind: "value", value: 0, literalType: "number" },
    { kind: "value", value: 0 },
  ],
  [
    { kind: "value", value: "2030-03-20", literalType: "date" },
    { kind: "value", value: "2030-03-20", literalType: "date" },
  ],
  [
    { kind: "value", value: "2030-03-20T12:00:00Z", literalType: "instant" },
    { kind: "value", value: "2030-03-20T12:00:00Z", literalType: "instant" },
  ],
  [
    { kind: "reference", nodeId: "read", path: ["expectedCloseDate"] },
    { kind: "value", value: null },
  ],
] satisfies [WorkflowNode["config"][string], WorkflowNode["config"][string]][])(
  "does not widen the older failed-task retry profile for the new mapping %j",
  (left, right) => {
    const graph: WorkflowDefinition = comparison(left, right);
    const before = structuredClone(graph);
    expect(validateDefinition(graph, { status: "complete", defs: [] }).ok).toBe(true);
    expect(retryableTaskDefinition(graph)).toBeNull();
    expect(graph).toStrictEqual(before);
  },
);
