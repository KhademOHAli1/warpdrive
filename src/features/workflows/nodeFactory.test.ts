import { expect, it } from "vitest";
import { initialDefinition } from "./editorModel";
import { makeNode } from "./nodeFactory";

it("uses only connected ancestors when choosing defaults for a new branch condition", () => {
  const graph = initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" });
  graph.edges = [];
  expect(makeNode(graph, "condition", "condition", "Check", "Call", "start").config.operator).toBe(
    "exists",
  );
  expect(makeNode(graph, "condition", "condition", "Check", "Call", "start").config.left).toEqual({
    kind: "reference",
    nodeId: "start",
    path: ["recordId"],
  });
  graph.edges = [{ from: "start", to: "read", port: "next" }];
  expect(makeNode(graph, "condition", "condition", "Check", "Call", "read").config.left).toEqual({
    kind: "reference",
    nodeId: "read",
    path: ["status"],
  });
});
