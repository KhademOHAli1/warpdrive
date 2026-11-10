import { assert, expect, it } from "vitest";
import { copyWorkflowDefinition } from "./copyDefinition";
import { validateDefinition } from "./definition";
import { updateNodeConfiguration } from "./graphEditor";
import { evaluateIfElse } from "./ifElse";
import {
  applyMappingSelection,
  describeMappingTarget,
  mappingOutputForReference,
} from "./mappingCatalog";
import { executableDefinition } from "./readiness";
import { selectRunBranch } from "./runBranchSelection";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import { projectLiveRunEffects } from "./ui/liveRunEffectSummary";

const start: WorkflowNode = {
  id: "start",
  type: "trigger.manual",
  version: 1,
  name: "Start",
  config: {},
};
function route(id: string, match: string) {
  return {
    id,
    predicate: {
      defaultPort: "false",
      expression: {
        kind: "group",
        id: `group_${id}`,
        operator: "and",
        children: [
          {
            kind: "predicate",
            id: `rule_${id}`,
            operator: "equals",
            left: { kind: "reference", nodeId: "start", path: ["recordId"] },
            right: { kind: "value", value: match },
          },
        ],
      },
    },
  };
}
function branchGraph() {
  const record = "00000000-0000-4000-8000-000000000001";
  const first = route("first", record);
  const second = route("second", record);
  const decide: WorkflowNode = {
    id: "decide",
    type: "ifElse",
    version: 1,
    name: "If/else",
    config: { branches: [first, second], fallbackId: "fallback" },
  };
  const create = (id: string): WorkflowNode => ({
    id,
    type: "record.create",
    version: 1,
    name: "Create person",
    config: { entity: "person", fields: { name: { kind: "value", value: id } } },
  });
  const graph: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [start, decide, create("primary"), create("secondary")],
    edges: [
      { from: "start", to: "decide", port: "next" },
      { from: "decide", to: "primary", port: "branch:first" },
      { from: "decide", to: "secondary", port: "branch:second" },
    ],
  };
  return { graph, decide, first, record };
}

it("registers a publishable first-match graph and finishes a valid unconnected Else route", () => {
  const { graph, decide, record } = branchGraph();
  const checked = validateDefinition(graph);
  assert(checked.ok, JSON.stringify(checked));
  expect(executableDefinition(checked.value)).toBe(true);
  expect(copyWorkflowDefinition(graph)).toEqual({ ok: true, value: graph });
  const selected = evaluateIfElse(
    decide.config,
    { start: { recordId: record } },
    { definition: graph, nodeId: decide.id },
  );
  assert(selected.ok, JSON.stringify(selected));
  expect(selected.value).toEqual({ matchingBranchId: "first" });
  expect(selectRunBranch(graph, decide, selected.value)).toEqual({
    ok: true,
    value: { from: "decide", to: "primary", port: "branch:first" },
  });
  expect(selectRunBranch(graph, decide, { matchingBranchId: "fallback" })).toEqual({
    ok: true,
    value: undefined,
  });
  expect(selectRunBranch(graph, decide, { matchingBranchId: "other" }).ok).toBe(false);
  expect(projectLiveRunEffects(graph)?.counts).toMatchObject({ ifElse: 1, recordCreate: 2 });
});

it("removes only the deleted route wire and leaves its downstream record step on the canvas", () => {
  const { graph, decide, first } = branchGraph();
  const changed = updateNodeConfiguration(graph, {
    ...decide,
    config: { branches: [first], fallbackId: "fallback" },
  });
  expect(changed.edges.map((edge) => edge.port)).toEqual(["next", "branch:first"]);
  expect(changed.nodes.map((node) => node.id)).toEqual(graph.nodes.map((node) => node.id));
  expect(graph.edges).toHaveLength(3);
});

it("maps a created lead into a compatible nested Task field without replacing its other fields", () => {
  const lead: WorkflowNode = {
    id: "lead",
    type: "record.create",
    version: 1,
    name: "Create lead",
    config: { entity: "lead", fields: { title: { kind: "value", value: "Follow up" } } },
  };
  const task: WorkflowNode = {
    id: "task",
    type: "record.create",
    version: 1,
    name: "Create task",
    config: { entity: "activity", fields: { subject: { kind: "value", value: "Call" } } },
  };
  const graph: WorkflowDefinition = {
    schemaVersion: 1,
    nodes: [start, lead, task],
    edges: [
      { from: "start", to: "lead", port: "next" },
      { from: "lead", to: "task", port: "next" },
    ],
  };
  const path = ["fields", "leadId"];
  const target = describeMappingTarget(graph, "task", path);
  assert(target.state === "ready");
  const reference = { kind: "reference", nodeId: "lead", path: ["id"] } as const;
  expect(mappingOutputForReference(graph, { ...reference, path: ["id"] })?.contract).toEqual({
    kind: "entity",
    entity: "lead",
    nullable: false,
  });
  const bound = applyMappingSelection(graph, "task", target.target, reference, undefined, true);
  assert(bound.ok);
  expect(bound.definition.nodes.find((node) => node.id === "task")?.config.fields).toEqual({
    subject: { kind: "value", value: "Call" },
    leadId: reference,
  });
  expect(validateDefinition(bound.definition).ok).toBe(true);
});
