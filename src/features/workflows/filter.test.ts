import { describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { getConfigurationSpec } from "./configurationSpec";
import { validateNodeConfiguration } from "./configurationValidation";
import { copyWorkflowDefinition } from "./copyDefinition";
import { validateDefinition } from "./definition";
import { draftSimulationNodeTypes } from "./draftSimulationReceipt";
import { evaluateFilter } from "./filter";
import { describeMappingOutputs } from "./mappingCatalog";
import { makeNode } from "./nodeFactory";
import { findPaletteEntry } from "./paletteCatalog";
import { executableDefinition, executableNode } from "./readiness";
import { selectRunBranch } from "./runBranchSelection";
import type { RunOutputs, StepOutput } from "./runTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";
import { projectLiveRunEffects } from "./ui/liveRunEffectSummary";

const value = (raw: string | number | boolean | null) => ({ kind: "value" as const, value: raw });
const reference = (field: string) => ({
  kind: "reference" as const,
  nodeId: "read",
  path: [field],
});
const baseConfig = () => ({
  left: reference("status"),
  operator: "equals",
  right: value("open"),
});
function fixture(config: WorkflowNode["config"] = baseConfig()): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "read",
        type: "record.read",
        version: 1,
        name: "Read",
        config: {
          entity: "deal",
          recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
      { id: "guard", type: "filter", version: 1, name: "Filter", config },
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Follow up",
        config: {
          subject: value("Follow up"),
          dealId: { kind: "reference", nodeId: "start", path: ["recordId"] },
        },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "guard", port: "next" },
      { from: "guard", to: "task", port: "next" },
    ],
  };
}
function guard(definition: WorkflowDefinition) {
  const node = definition.nodes.find((entry) => entry.id === "guard");
  if (node === undefined) throw new Error("Missing filter fixture");
  return node;
}
function evaluate(config: WorkflowNode["config"], outputs: RunOutputs) {
  const definition = fixture(config);
  return evaluateFilter(config, outputs, { definition, nodeId: "guard" });
}
function grouped(operator: "and" | "or", laterField = "expectedCloseDate"): WorkflowNode["config"] {
  return {
    defaultPort: "false",
    expression: {
      kind: "group",
      id: "root",
      operator,
      children: [
        {
          kind: "predicate",
          id: "status",
          left: reference("status"),
          operator: "equals",
          right: value("open"),
        },
        { kind: "predicate", id: "date", left: reference(laterField), operator: "exists" },
      ],
    },
  };
}

describe("Filter execution contract", () => {
  it.each([
    ["open", true],
    ["won", false],
  ] as const)(
    "evaluates %s and returns a filter result without mutating inputs",
    (status, matchesFilter) => {
      const config = baseConfig();
      const outputs = { read: { status } };
      const before = structuredClone({ config, outputs });
      expect(evaluate(config, outputs)).toEqual({ ok: true, value: { matchesFilter } });
      expect({ config, outputs }).toEqual(before);
    },
  );

  it("continues a matching filter and ends a non-matching filter successfully", () => {
    const definition = fixture();
    const node = guard(definition);
    expect(selectRunBranch(definition, node, { matchesFilter: true })).toEqual({
      ok: true,
      value: { from: "guard", to: "task", port: "next" },
    });
    expect(selectRunBranch(definition, node, { matchesFilter: false })).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("distinguishes missing or invalid operands from a non-match", () => {
    expect(evaluate(baseConfig(), { read: {} })).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_BINDING_MISSING,
    });
    expect(
      evaluate({ ...baseConfig(), operator: "unreviewed" }, { read: { status: "open" } }),
    ).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  });

  it("evaluates grouped predicates and short-circuits valid unused runtime operands", () => {
    expect(evaluate(grouped("and"), { read: { status: "won" } })).toEqual({
      ok: true,
      value: { matchesFilter: false },
    });
    expect(evaluate(grouped("or"), { read: { status: "open" } })).toEqual({
      ok: true,
      value: { matchesFilter: true },
    });
    expect(evaluate(grouped("and"), { read: { status: "open", expectedCloseDate: null } })).toEqual(
      {
        ok: true,
        value: { matchesFilter: false },
      },
    );
    expect(
      evaluate(grouped("and"), { read: { status: "open", expectedCloseDate: "2028-02-29" } }),
    ).toEqual({
      ok: true,
      value: { matchesFilter: true },
    });
    expect(evaluate(grouped("or", "unknownOutput"), { read: { status: "open" } })).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  });

  it.each([
    {},
    { result: false },
    { matchesFilter: "false" },
    Object.create({ matchesFilter: false }) as StepOutput,
  ])("rejects malformed or inherited filter receipts instead of silently stopping", (output) => {
    const definition = fixture();
    expect(selectRunBranch(definition, guard(definition), output)).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  });

  it("rejects invalid graph branches before accepting a non-match", () => {
    const definition = fixture();
    definition.edges[2] = { from: "guard", to: "task", port: "false" };
    expect(selectRunBranch(definition, guard(definition), { matchesFilter: false })).toEqual({
      ok: false,
      error: ERROR_IDS.WORKFLOW_INVALID,
    });
  });
});

describe("Filter authoring and publication contracts", () => {
  it("has an executable, validated, copyable configuration profile and insertable catalog entry", () => {
    const definition = fixture(grouped("and"));
    expect(validateDefinition(definition).ok).toBe(true);
    expect(validateNodeConfiguration(guard(definition), { definition }).status).toBe("valid");
    expect(executableDefinition(definition)).toBe(true);
    expect(copyWorkflowDefinition(definition)).toEqual({ ok: true, value: definition });
    expect(getConfigurationSpec("filter", 1)).toMatchObject({ supported: true });
    expect(getConfigurationSpec("filter", 1)?.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ control: "operator" })]),
    );
    expect(findPaletteEntry("filter", 1)).toMatchObject({
      support: "supported",
      selection: "insert",
      profile: "scalar-condition",
    });
    expect(draftSimulationNodeTypes).toContain("filter");
  });

  it("keeps incomplete saved drafts copyable but does not admit them to execution", () => {
    const definition = fixture({});
    expect(copyWorkflowDefinition(definition).ok).toBe(true);
    expect(executableNode(guard(definition))).toBe(false);
    expect(validateNodeConfiguration(guard(definition), { definition }).status).toBe("invalid");
  });

  it("exposes a typed matchesFilter output only to downstream nodes", () => {
    const definition = fixture();
    expect(describeMappingOutputs(definition, "task").outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: "guard",
          path: ["matchesFilter"],
          contract: { kind: "boolean", nullable: false },
        }),
      ]),
    );
    expect(
      describeMappingOutputs(definition, "read").outputs.some(
        (output) => output.nodeId === "guard",
      ),
    ).toBe(false);
  });

  it("creates an ordinary next-port filter with a valid upstream default and includes it in run review", () => {
    const definition = fixture();
    const node = makeNode(definition, "filter", "second", "Filter", "", "guard");
    expect(node.type).toBe("filter");
    const next = structuredClone(definition);
    next.nodes.push(node);
    next.edges[2] = { from: "guard", to: "second", port: "next" };
    next.edges.push({ from: "second", to: "task", port: "next" });
    expect(validateDefinition(next).ok).toBe(true);
    expect(projectLiveRunEffects(next)).toMatchObject({
      configuredSteps: 5,
      counts: { filter: 2, task: 1 },
    });
  });
});
