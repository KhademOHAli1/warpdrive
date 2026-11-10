import { expect, it } from "vitest";
import { appendConnectedNode } from "./connectionGestures";
import { validateDefinition } from "./definition";
import { describeMappingOutputs } from "./mappingCatalog";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import { workflowIteratorGraphReady } from "./workflowIteratorGraph";

const iterator: WorkflowNode = {
  id: "iterate",
  name: "Iterator",
  type: "iterator",
  version: 1,
  config: { items: { kind: "literal", itemKind: "text", items: ["Ada", "Grace"] } },
};

function task(id: string, source: string): WorkflowNode {
  return {
    id,
    name: id,
    type: "activity.create",
    version: 1,
    config: { subject: { kind: "reference", nodeId: iterator.id, path: [source] } },
  };
}

function graph(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "start",
        type: "trigger.manual",
        version: 1,
        name: "Start",
        config: { scope: "global" },
      },
      iterator,
      task("per_item", "currentItem"),
      task("after", "processedCount"),
    ],
    edges: [
      { from: "start", to: iterator.id, port: "next" },
      { from: iterator.id, to: "per_item", port: "loop" },
      { from: iterator.id, to: "after", port: "done" },
    ],
  };
}

it("offers per-item values only in the loop and summary values only after it", () => {
  const definition = graph();
  const outputs = (id: string) =>
    describeMappingOutputs(definition, id).outputs.map((item) => item.field);
  expect(outputs("per_item")).toEqual(["currentItemIndex", "currentItem"]);
  expect(outputs("after")).toEqual(["processedCount", "failedCount", "hasProcessedAllItems"]);
  expect(workflowIteratorGraphReady(definition)).toBe(true);
  definition.nodes[3] = task("after", "currentItem");
  expect(validateDefinition(definition)).toMatchObject({
    ok: false,
    error: expect.arrayContaining([
      expect.objectContaining({ code: "unknown_output", nodeId: "after" }),
    ]),
  });
});

it("inserts Iterator on an existing connection and continues its old path after completion", () => {
  const start = graph().nodes[0];
  if (start === undefined) throw new Error("Missing trigger");
  const after = {
    ...task("after", "processedCount"),
    config: { subject: { kind: "value", value: "Follow up" } },
  };
  const original: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [start, after],
    edges: [{ from: "start", to: after.id, port: "next" }],
  };
  expect(
    appendConnectedNode(original, iterator, { x: 0, y: 75 }, { from: "start", port: "next" }),
  ).toMatchObject({
    ok: true,
    value: {
      edges: [
        { from: "start", to: iterator.id, port: "next" },
        { from: iterator.id, to: "after", port: "done" },
      ],
    },
  });
});
