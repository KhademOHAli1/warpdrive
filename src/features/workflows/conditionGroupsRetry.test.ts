import { expect, it } from "vitest";
import { validateDefinition } from "./definition";
import { initialDefinition } from "./editorModel";
import { executableDefinition } from "./readiness";
import { retryableTaskDefinition } from "./runRetryProfile";
import type { WorkflowNode } from "./schemas";

function fixture(config: WorkflowNode["config"]) {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Matched",
    subject: "Follow up",
  });
  const task = definition.nodes.find((node) => node.id === "task");
  if (task === undefined) throw new Error("Missing task fixture");
  definition.nodes.push(
    { id: "check", type: "condition", version: 1, name: "Check", config },
    { ...structuredClone(task), id: "otherwise", name: "Otherwise" },
  );
  definition.edges = [
    { from: "start", to: "read", port: "next" },
    { from: "read", to: "check", port: "next" },
    { from: "check", to: "task", port: "true" },
    { from: "check", to: "otherwise", port: "false" },
  ];
  return definition;
}
const flat = {
  left: { kind: "value", value: true },
  operator: "equals",
  right: { kind: "value", value: true },
};

it("keeps the existing valid flat-condition follow-up profile retryable", () => {
  const source = fixture(flat);
  expect(validateDefinition(source, { status: "complete", defs: [] }).ok).toBe(true);
  expect(executableDefinition(source)).toBe(true);
  expect(retryableTaskDefinition(source)).toStrictEqual(source);
});

it("does not widen failed-task recovery to an otherwise valid grouped profile without custom fields or typed intent", () => {
  const source = fixture({
    expression: {
      kind: "group",
      id: "all",
      operator: "and",
      children: [{ kind: "predicate", id: "first", ...flat }],
    },
    defaultPort: "false",
  });
  const before = structuredClone(source);
  expect(validateDefinition(source, { status: "complete", defs: [] }).ok).toBe(true);
  expect(executableDefinition(source)).toBe(true);
  expect(retryableTaskDefinition(source)).toBeNull();
  expect(source).toStrictEqual(before);
});
