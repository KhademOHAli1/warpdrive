import { expect, it } from "vitest";
import { copyWorkflowDefinition } from "./copyDefinition";
import { initialDefinition } from "./editorModel";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

type Config = WorkflowNode["config"];
const value = (literal: string | number | boolean | null) => ({ kind: "value", value: literal });
const leaf = (id: string) => ({
  kind: "predicate",
  id,
  left: value(true),
  operator: "equals",
  right: value(true),
});
const group = (id: string, children: Config[string][], operator = "and") => ({
  kind: "group",
  id,
  operator,
  children,
});
const grouped = (expression: Config[string]): Config => ({ expression, defaultPort: "false" });

function graph(config: Config): WorkflowDefinition {
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

const copyable: Config[] = [
  grouped(group("all", [leaf("first")])),
  grouped(group("all", [leaf("first"), group("any", [leaf("second")], "or")])),
  grouped(group("empty", [])),
  grouped(
    group("partial", [{ kind: "predicate", id: "first", left: value(false), operator: "equals" }]),
  ),
  grouped(
    group("invalid_intent", [
      { ...leaf("numeric"), right: { kind: "value", value: "-", literalType: "number" } },
      { ...leaf("date"), right: { kind: "value", value: "2030-02-30", literalType: "date" } },
    ]),
  ),
  {
    expression: {
      kind: "group",
      operator: "and",
      children: [{ kind: "predicate", id: "partial", operator: "equals" }],
    },
  },
];

it.each(copyable)(
  "copies reviewed complete or incomplete group JSON without completing it: %j",
  (config) => {
    const source = graph(config);
    const before = structuredClone(source);
    const result = copyWorkflowDefinition(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected an inert detached draft copy");
    expect(result.value).toStrictEqual(before);
    expect(source).toStrictEqual(before);
    expect(result.value).not.toBe(source);
    expect(result.value.nodes).not.toBe(source.nodes);
    expect(result.value.nodes.find((node) => node.id === "check")?.config).not.toBe(config);
  },
);

it.each([
  { ...grouped(group("all", [leaf("first")])), defaultPort: "next" },
  grouped({ kind: "program", id: "unknown", children: [] }),
  { ...grouped(group("all", [leaf("first")])), credentials: "unreviewed" },
  grouped(group("all", [{ ...leaf("first"), token: "unreviewed" }])),
  { ...grouped(group("all", [leaf("first")])), left: value(true), operator: "exists" },
  grouped(
    group("all", [{ ...leaf("first"), left: { kind: "value", value: ["rich global literal"] } }]),
  ),
] satisfies Config[])("rejects unknown, mixed or unreviewed grouped fields: %j", (config) => {
  const source = graph(config);
  expect(copyWorkflowDefinition(source)).toMatchObject({ ok: false, reason: "copy-unavailable" });
  expect(source.nodes.find((node) => node.id === "check")?.config).toStrictEqual(config);
});

it("rejects excessive nesting without truncating or dropping authored predicates", () => {
  const config = grouped(
    group("one", [group("two", [group("three", [group("four", [leaf("last")])])])]),
  );
  const source = graph(config);
  const before = structuredClone(source);
  expect(copyWorkflowDefinition(source)).toMatchObject({ ok: false, reason: "copy-unavailable" });
  expect(source).toStrictEqual(before);
});

it("rejects a ninth child even when the total predicate count is otherwise bounded", () => {
  const source = graph(
    grouped(
      group(
        "all",
        Array.from({ length: 9 }, (_, index) => leaf(`p_${index}`)),
      ),
    ),
  );
  expect(copyWorkflowDefinition(source)).toMatchObject({ ok: false, reason: "copy-unavailable" });
  expect(source.nodes.find((node) => node.id === "check")?.config).toHaveProperty(
    "expression.children.length",
    9,
  );
});

function nearNodeLimit(extraGroup: boolean) {
  return grouped(
    group(
      "root",
      Array.from({ length: 8 }, (_, branch) => {
        const leaves = Array.from({ length: 4 }, (_, index) => leaf(`p_${branch}_${index}`));
        return group(
          `branch_${branch}`,
          branch < 7 || extraGroup ? [group(`inner_${branch}`, leaves)] : leaves,
        );
      }),
    ),
  );
}

it("retains the 48-node boundary but rejects 49 nodes with exactly 32 predicates and valid local child limits", () => {
  const allowed = graph(nearNodeLimit(false));
  const copied = copyWorkflowDefinition(allowed);
  expect(copied.ok).toBe(true);
  if (copied.ok) expect(copied.value).toStrictEqual(allowed);
  const rejected = graph(nearNodeLimit(true));
  const before = structuredClone(rejected);
  expect(copyWorkflowDefinition(rejected)).toMatchObject({ ok: false, reason: "copy-unavailable" });
  expect(rejected).toStrictEqual(before);
});

it("rejects explicit undefined rather than silently erasing an unfinished default", () => {
  const source = graph(grouped(group("all", [leaf("first")])));
  const raw = {
    ...source,
    nodes: source.nodes.map((node) =>
      node.id === "check" ? { ...node, config: { ...node.config, defaultPort: undefined } } : node,
    ),
  };
  expect(copyWorkflowDefinition(raw)).toMatchObject({ ok: false, reason: "copy-unavailable" });
});
