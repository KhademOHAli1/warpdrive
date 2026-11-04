import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { evaluateCondition } from "./condition";
import { initialDefinition } from "./editorModel";
import { stringBinding } from "./runBindings";
import type { WorkflowNode } from "./schemas";

it.each([
  ["equals", "open", "open", true],
  ["notEquals", "open", "won", true],
  ["contains", "پیگیری مشتری", "مشتری", true],
  ["exists", null, null, false],
  ["equals", "1", 1, false],
])("evaluates %s without coercing values", (operator, left, right, result) => {
  expect(
    evaluateCondition(
      { left: { kind: "value", value: left }, operator, right: { kind: "value", value: right } },
      {},
    ).ok,
  ).toBe(true);
  expect(
    evaluateCondition(
      { left: { kind: "value", value: left }, operator, right: { kind: "value", value: right } },
      {},
    ),
  ).toEqual({ ok: true, value: { result } });
});
it("does not silently turn an unavailable mapping into a false branch", () => {
  expect(
    evaluateCondition(
      {
        left: { kind: "reference", nodeId: "missing", path: ["status"] },
        operator: "equals",
        right: { kind: "value", value: "open" },
      },
      {},
    ).ok,
  ).toBe(false);
});

it("does not resolve inherited properties as completed step outputs", () => {
  expect(
    evaluateCondition(
      {
        left: { kind: "reference", nodeId: "constructor", path: ["name"] },
        operator: "equals",
        right: { kind: "value", value: "Object" },
      },
      {},
    ),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_BINDING_MISSING });
});

it("rejects inherited values in task bindings too", () => {
  expect(stringBinding({ kind: "reference", nodeId: "constructor", path: ["name"] }, {})).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
  });
});

function conditionContext(config: WorkflowNode["config"]) {
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Follow up",
  });
  const task = definition.nodes.find((node) => node.id === "task");
  if (task === undefined) throw new Error("Missing finite condition fixture task");
  definition.nodes.push({ ...structuredClone(task), id: "other" });
  definition.nodes.push({ id: "check", type: "condition", version: 1, name: "Check date", config });
  definition.edges = definition.edges.filter((edge) => edge.to !== "task");
  definition.edges.push(
    { from: "read", to: "check", port: "next" },
    { from: "check", to: "task", port: "true" },
    { from: "check", to: "other", port: "false" },
  );
  return { definition, nodeId: "check" };
}

it("uses the actual pinned source descriptor for typed date equality", () => {
  const config = {
    left: { kind: "reference", nodeId: "read", path: ["expectedCloseDate"] },
    operator: "equals",
    right: { kind: "value", value: "2028-02-29", literalType: "date" },
  };
  expect(
    evaluateCondition(
      config,
      { read: { expectedCloseDate: "2028-02-29" } },
      conditionContext(config),
    ),
  ).toEqual({ ok: true, value: { result: true } });
});

it("retains the old primitive comparison behavior while rejecting generic text as a typed date", () => {
  const config = {
    left: { kind: "reference", nodeId: "read", path: ["expectedCloseDate"] },
    operator: "equals",
    right: { kind: "value", value: "2028-02-29" },
  };
  expect(
    evaluateCondition(
      config,
      { read: { expectedCloseDate: "2028-02-29" } },
      conditionContext(config),
    ),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
});

it("returns a missing-binding error for old completed receipts instead of false or today's date", () => {
  const config = {
    left: { kind: "reference", nodeId: "read", path: ["expectedCloseDate"] },
    operator: "exists",
  };
  expect(
    evaluateCondition(config, { read: { title: "Historical receipt" } }, conditionContext(config)),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_BINDING_MISSING });
});

it("refuses a stored out-of-scope source even when the value happens to match", () => {
  const config = {
    left: { kind: "reference", nodeId: "read", path: ["title"] },
    operator: "equals",
    right: { kind: "value", value: "Match" },
  };
  const context = conditionContext(config);
  context.definition.edges = [];
  expect(evaluateCondition(config, { read: { title: "Match" } }, context)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});
