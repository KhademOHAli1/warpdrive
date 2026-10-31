import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { evaluateCondition } from "./condition";
import { stringBinding } from "./runBindings";

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
