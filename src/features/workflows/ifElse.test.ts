import { expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { initialDefinition } from "./editorModel";
import {
  boundedIfElseConfig,
  branchPort,
  branchPortSchema,
  evaluateIfElse,
  type IfElseConfig,
  ifElseBranchLimit,
  ifElsePorts,
  newIfElseBranch,
  newIfElseConfig,
  parseIfElseConfig,
  prepareIfElseConfig,
} from "./ifElse";
import type { WorkflowNode } from "./schemas";

function predicate(field: string, operator: "equals" | "exists", value?: string) {
  return {
    defaultPort: "false",
    expression: {
      kind: "group",
      id: "group",
      operator: "and",
      children: [
        {
          kind: "predicate",
          id: "rule",
          left: { kind: "reference", nodeId: "read", path: [field] },
          operator,
          ...(value === undefined ? {} : { right: { kind: "value", value } }),
        },
      ],
    },
  };
}

function fixture() {
  const raw: IfElseConfig = {
    branches: [
      { id: "won", predicate: predicate("status", "equals", "won") },
      { id: "dated", predicate: predicate("expectedCloseDate", "exists") },
    ],
    fallbackId: "otherwise",
  };
  const definition = initialDefinition({
    start: "Start",
    read: "Read",
    task: "Task",
    subject: "Call",
  });
  const node: WorkflowNode = {
    id: "switch",
    type: "ifElse",
    version: 1,
    name: "Pick a route",
    config: raw,
  };
  definition.nodes.push(node);
  definition.edges = [
    { from: "start", to: "read", port: "next" },
    { from: "read", to: node.id, port: "next" },
    { from: node.id, to: "task", port: branchPort("won") },
  ];
  return { raw, context: { definition, nodeId: node.id } };
}

it("takes the first true route, a later route, or the explicit fallback in authored order", () => {
  const { raw, context } = fixture();
  const before = structuredClone(context.definition);
  expect(
    evaluateIfElse(raw, { read: { status: "won", expectedCloseDate: "2028-02-29" } }, context),
  ).toEqual({ ok: true, value: { matchingBranchId: "won" } });
  expect(
    evaluateIfElse(raw, { read: { status: "open", expectedCloseDate: "2028-02-29" } }, context),
  ).toEqual({ ok: true, value: { matchingBranchId: "dated" } });
  expect(
    evaluateIfElse(raw, { read: { status: "open", expectedCloseDate: null } }, context),
  ).toEqual({ ok: true, value: { matchingBranchId: "otherwise" } });
  expect(context.definition).toEqual(before);
});

it("skips later runtime reads after a match and preserves missing-binding errors on a reached route", () => {
  const { raw, context } = fixture();
  expect(evaluateIfElse(raw, { read: { status: "won" } }, context)).toEqual({
    ok: true,
    value: { matchingBranchId: "won" },
  });
  expect(evaluateIfElse(raw, { read: { status: "open" } }, context)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
  });
});

it("rejects an incomplete later comparison before a first match can skip it", () => {
  const { raw, context } = fixture();
  raw.branches[1] = { id: "dated", predicate: predicate("status", "equals") };
  expect(parseIfElseConfig(raw, "draft").ok).toBe(true);
  expect(parseIfElseConfig(raw, "copy").ok).toBe(true);
  const prepared = prepareIfElseConfig(raw, context);
  expect(prepared).toMatchObject({
    ok: false,
    error: expect.arrayContaining([
      expect.objectContaining({
        nodeId: "switch",
        path: ["branches", "1", "predicate", "expression", "children", "0", "right"],
        code: "required",
      }),
    ]),
  });
  expect(evaluateIfElse(raw, { read: { status: "won" } }, context)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});

it("validates the real predecessor path on every route, including a route after a match", () => {
  const { raw, context } = fixture();
  const unreachable: WorkflowNode = {
    id: "otherRead",
    type: "record.read",
    version: 1,
    name: "Detached read",
    config: { entity: "deal" },
  };
  context.definition.nodes.push(unreachable);
  raw.branches[1] = {
    id: "dated",
    predicate: {
      defaultPort: "false",
      expression: {
        kind: "group",
        id: "group",
        operator: "and",
        children: [
          {
            kind: "predicate",
            id: "rule",
            left: { kind: "reference", nodeId: unreachable.id, path: ["expectedCloseDate"] },
            operator: "exists",
          },
        ],
      },
    },
  };
  expect(evaluateIfElse(raw, { read: { status: "won" } }, context)).toEqual({
    ok: false,
    error: ERROR_IDS.WORKFLOW_INVALID,
  });
});

it("retains ordered unique ports through draft and copy without inventing a match for a new route", () => {
  const raw = newIfElseConfig();
  raw.branches.push(newIfElseBranch("follow_up"));
  expect(ifElsePorts(raw)).toEqual(["branch:if", "branch:follow_up", "branch:else"]);
  for (const mode of ["draft", "copy"] as const) {
    const parsed = parseIfElseConfig(raw, mode);
    expect(parsed).toEqual({ ok: true, value: raw });
    if (parsed.ok) expect(ifElsePorts(parsed.value)).toEqual(ifElsePorts(raw));
  }
  expect(parseIfElseConfig(raw, "execute").ok).toBe(false);
});

it.each([
  {
    label: "fallback also used as a condition ID",
    raw: { branches: [newIfElseBranch("else")], fallbackId: "else" },
  },
  {
    label: "duplicate branch IDs",
    raw: { branches: [newIfElseBranch("if"), newIfElseBranch("if")], fallbackId: "else" },
  },
  { label: "invalid branch ID", raw: { branches: [newIfElseBranch("x:y")], fallbackId: "else" } },
  { label: "missing fallback", raw: { branches: [newIfElseBranch("if")] } },
  { label: "extra private data", raw: { ...newIfElseConfig(), actorId: "private" } },
  {
    label: "too many routes",
    raw: {
      branches: Array.from({ length: ifElseBranchLimit + 1 }, (_, index) =>
        newIfElseBranch(`rule_${index}`),
      ),
      fallbackId: "else",
    },
  },
])("rejects $label at the bounded config boundary", ({ raw }) => {
  expect(boundedIfElseConfig(raw)).toBe(false);
  expect(parseIfElseConfig(raw, "draft").ok).toBe(false);
  expect(ifElsePorts(raw)).toEqual([]);
});

it("rejects cyclic grouped predicates before parsing JSON and disallows nested port delimiters", () => {
  const expression = { kind: "group", id: "loop", operator: "and", children: [] as unknown[] };
  expression.children.push(expression);
  const raw = {
    branches: [{ id: "if", predicate: { expression, defaultPort: "false" } }],
    fallbackId: "else",
  };
  expect(boundedIfElseConfig(raw)).toBe(false);
  expect(parseIfElseConfig(raw, "draft").ok).toBe(false);
  expect(branchPortSchema.safeParse("branch:route_a").success).toBe(true);
  expect(branchPortSchema.safeParse("branch:route:a").success).toBe(false);
  expect(branchPortSchema.safeParse("true").success).toBe(false);
});
