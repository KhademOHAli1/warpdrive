import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { evaluateCondition } from "./condition";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

type Json = WorkflowNode["config"][string];
const value = (raw: string | number | boolean | null) => ({ kind: "value" as const, value: raw });
const reference = (field: string, nodeId = "read") => ({
  kind: "reference" as const,
  nodeId,
  path: [field],
});
function predicate(id: string, left: Json, operator = "equals", right?: Json): Json {
  return { kind: "predicate", id, left, operator, ...(right === undefined ? {} : { right }) };
}
function group(id: string, operator: "and" | "or", children: Json[]): Json {
  return { kind: "group", id, operator, children };
}
function config(expression: Json): WorkflowNode["config"] {
  return { expression, defaultPort: "false" };
}
function context(raw: WorkflowNode["config"]) {
  const definition: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read deal",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      {
        id: "wait",
        type: "delay",
        version: 1,
        name: "Completed wait",
        config: { minutes: value(1) },
      },
      { id: "check", type: "condition", version: 1, name: "Evaluate groups", config: raw },
      {
        id: "matched",
        type: "activity.create",
        version: 1,
        name: "Matched",
        config: { subject: value("Matched"), dealId: reference("id") },
      },
      {
        id: "otherwise",
        type: "activity.create",
        version: 1,
        name: "Otherwise",
        config: { subject: value("Otherwise"), dealId: reference("id") },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "wait", port: "next" },
      { from: "wait", to: "check", port: "next" },
      { from: "check", to: "matched", port: "true" },
      { from: "check", to: "otherwise", port: "false" },
    ],
  };
  return { definition, nodeId: "check" };
}
function evaluate(raw: WorkflowNode["config"], outputs: RunOutputs = {}) {
  return evaluateCondition(raw, outputs, context(raw));
}
function single(left: Json, operator: string, right?: Json) {
  return config(group("rules", "and", [predicate("one", left, operator, right)]));
}

it("evaluates nested AND/OR truth tables without mutating the pinned definition or receipts", () => {
  const raw = config(
    group("root", "and", [
      predicate("open", reference("status"), "equals", value("open")),
      group("details", "or", [
        predicate("title", reference("title"), "contains", value("Customer")),
        predicate("date", reference("expectedCloseDate"), "exists"),
      ]),
    ]),
  );
  for (const [status, title, date, result] of [
    ["open", "Customer deal", null, true],
    ["open", "Other deal", "2028-02-29", true],
    ["open", "Other deal", null, false],
    ["won", "Customer deal", "2028-02-29", false],
  ] as const) {
    const outputs = { read: { status, title, expectedCloseDate: date } };
    const before = structuredClone({ raw, outputs });
    expect(evaluate(raw, outputs)).toEqual({ ok: true, value: { result } });
    expect({ raw, outputs }).toEqual(before);
  }
});

it("short-circuits false AND before a valid missing or invalid runtime operand", () => {
  const raw = config(
    group("root", "and", [
      predicate("first", reference("status"), "equals", value("won")),
      predicate("later", reference("expectedCloseDate"), "exists"),
    ]),
  );
  expect(evaluate(raw, { read: { status: "open" } })).toEqual({
    ok: true,
    value: { result: false },
  });
  expect(
    evaluate(raw, { read: { status: "open", expectedCloseDate: "private invalid date" } }),
  ).toEqual({ ok: true, value: { result: false } });
});

it("short-circuits true OR before a valid missing or invalid runtime operand", () => {
  const raw = config(
    group("root", "or", [
      predicate("first", reference("status"), "equals", value("open")),
      predicate("later", reference("expectedCloseDate"), "exists"),
    ]),
  );
  expect(evaluate(raw, { read: { status: "open" } })).toEqual({
    ok: true,
    value: { result: true },
  });
  expect(
    evaluate(raw, { read: { status: "open", expectedCloseDate: "private invalid date" } }),
  ).toEqual({ ok: true, value: { result: true } });
});

it.each(["and", "or"] as const)(
  "fails a needed %s operand instead of selecting default",
  (operator) => {
    const raw = config(
      group("root", operator, [
        predicate(
          "first",
          reference("status"),
          "equals",
          value(operator === "and" ? "open" : "won"),
        ),
        predicate("later", reference("expectedCloseDate"), "exists"),
      ]),
    );
    expect(evaluate(raw, { read: { status: "open" } })).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
    });
    expect(evaluate(raw, { read: { status: "open", expectedCloseDate: "invalid" } })).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  },
);

it.each([
  predicate("unavailable", reference("undeclaredOutput"), "exists"),
  predicate("invalid_intent", value(1), "equals", {
    kind: "value",
    value: "12",
    literalType: "number",
  }),
])("validates every static predicate before a true OR can hide an invalid row", (invalid) => {
  const raw = config(
    group("root", "or", [predicate("first", value(true), "equals", value(true)), invalid]),
  );
  expect(evaluate(raw)).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
});

it("requires own source and property keys and keeps absence distinct from explicit null", () => {
  const raw = single(reference("expectedCloseDate"), "exists");
  const source: RunOutputs = {};
  Object.setPrototypeOf(source, { read: { expectedCloseDate: "2028-02-29" } });
  const property: StepOutput = {};
  Object.setPrototypeOf(property, { expectedCloseDate: "2028-02-29" });
  expect(evaluate(raw, source)).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_BINDING_MISSING });
  expect(evaluate(raw, { read: property })).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
  });
  expect(evaluate(raw, { read: { expectedCloseDate: null } })).toEqual({
    ok: true,
    value: { result: false },
  });
});

it("keeps false, zero and empty text present while null is absent for exists", () => {
  for (const [raw, result] of [
    [false, true],
    [0, true],
    ["", true],
    [null, false],
  ] as const) {
    expect(evaluateCondition(single(value(raw), "exists"), {})).toEqual({
      ok: true,
      value: { result },
    });
  }
});

it("retains strict explicit-null equality and inequality without omission or defaults", () => {
  expect(
    evaluate(single(reference("expectedCloseDate"), "equals", value(null)), {
      read: { expectedCloseDate: null },
    }),
  ).toEqual({ ok: true, value: { result: true } });
  expect(
    evaluate(single(reference("expectedCloseDate"), "notEquals", value(null)), {
      read: { expectedCloseDate: "2028-02-29" },
    }),
  ).toEqual({ ok: true, value: { result: true } });
  expect(evaluateCondition(single(value(null), "equals", value("")), {})).toEqual({
    ok: true,
    value: { result: false },
  });
});

it.each([
  [null, false],
  ["", true],
  [" ", false],
  ["Customer", false],
  [0, "invalid"],
] as const)("applies grouped-only empty-text semantics to %j", (raw, result) => {
  const actual = evaluateCondition(single(value(raw), "isEmpty"), {});
  expect(actual).toEqual(
    result === "invalid"
      ? { ok: false, error: ERROR_IDS.WORKFLOW_INVALID }
      : { ok: true, value: { result } },
  );
});

it("compares finite native numbers exactly while preserving legacy cross-primitive behavior", () => {
  expect(evaluateCondition(single(value(0), "equals", value(0)), {})).toEqual({
    ok: true,
    value: { result: true },
  });
  expect(evaluateCondition(single(value(-1.25), "notEquals", value(0)), {})).toEqual({
    ok: true,
    value: { result: true },
  });
  expect(evaluateCondition({ left: value("1"), operator: "equals", right: value(1) }, {})).toEqual({
    ok: true,
    value: { result: false },
  });
  expect(
    evaluateCondition({ left: value(2), operator: "greaterThan", right: value(1) }, {}),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_NOT_READY });
});

it("uses exact untagged full-decimal RHS text without normalizing its spelling", () => {
  const raw = single(reference("value"), "equals", value("0012.3400"));
  expect(evaluate(raw, { read: { value: "0012.3400" } })).toEqual({
    ok: true,
    value: { result: true },
  });
  expect(evaluate(raw, { read: { value: "12.34" } })).toEqual({
    ok: true,
    value: { result: false },
  });
  expect(
    evaluate(single(reference("value"), "notEquals", value("12.34")), {
      read: { value: "0012.3400" },
    }),
  ).toEqual({ ok: true, value: { result: true } });
});

it("accepts exact decimal fragments for contains without demanding a full decimal or casting to number", () => {
  const raw = single(reference("value"), "contains", value(".3400"));
  expect(evaluate(raw, { read: { value: "0012.3400" } })).toEqual({
    ok: true,
    value: { result: true },
  });
  expect(
    evaluate(single(reference("value"), "contains", value("")), { read: { value: "0012.3400" } }),
  ).toEqual({ ok: true, value: { result: true } });
});

it("rejects a native number, generic text source or nondecimal full literal as a qualified decimal RHS", () => {
  const outputs = { read: { value: "12.34", title: "12.34" } };
  for (const right of [value(12.34), reference("title"), value("12.34suffix")]) {
    expect(evaluate(single(reference("value"), "equals", right), outputs)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  }
});

it("uses canonical civil dates and rejects invalid actual dates or generic text pretending to be dates", () => {
  const typed = { kind: "value", value: "2028-02-29", literalType: "date" };
  expect(
    evaluate(single(reference("expectedCloseDate"), "equals", typed), {
      read: { expectedCloseDate: "2028-02-29" },
    }),
  ).toEqual({ ok: true, value: { result: true } });
  expect(
    evaluate(single(reference("expectedCloseDate"), "equals", typed), {
      read: { expectedCloseDate: "2027-02-29" },
    }),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
  expect(
    evaluate(single(reference("expectedCloseDate"), "equals", value("2028-02-29")), {
      read: { expectedCloseDate: "2028-02-29" },
    }),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
});

it("compares completed instant outputs by offset-equivalent instant and retains fractional precision", () => {
  const outputs = { wait: { resumeAt: "2030-03-20T12:00:00.123456789Z" } };
  const typed = (raw: string) => ({ kind: "value", value: raw, literalType: "instant" });
  expect(
    evaluate(
      single(reference("resumeAt", "wait"), "equals", typed("2030-03-20T13:00:00.123456789+01:00")),
      outputs,
    ),
  ).toEqual({ ok: true, value: { result: true } });
  expect(
    evaluate(
      single(reference("resumeAt", "wait"), "equals", typed("2030-03-20T12:00:00.123456788Z")),
      outputs,
    ),
  ).toEqual({ ok: true, value: { result: false } });
  expect(
    evaluate(single(reference("resumeAt", "wait"), "contains", value("2030")), outputs),
  ).toEqual({ ok: false, error: ERROR_IDS.WORKFLOW_INVALID });
});

it("requires pinned graph context for grouped references while allowing literal-only groups", () => {
  const raw = single(reference("status"), "equals", value("open"));
  expect(evaluateCondition(raw, { read: { status: "open" } })).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
  expect(evaluateCondition(single(value(true), "equals", value(true)), {})).toEqual({
    ok: true,
    value: { result: true },
  });
});
