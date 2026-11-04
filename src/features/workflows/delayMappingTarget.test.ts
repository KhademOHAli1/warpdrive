import { expect, it, vi } from "vitest";
import { mappingGraph } from "./mapping.test-helpers";
import { applyMappingSelection, describeMappingTarget, inspectMapping } from "./mappingCatalog";
import type { WorkflowDefinition } from "./schemas";

function graph(): WorkflowDefinition {
  return {
    schemaVersion: 1,
    nodes: [
      { id: "start", type: "trigger.manual", version: 1, name: "Start", config: {} },
      {
        id: "earlier",
        type: "delay",
        version: 1,
        name: "Earlier",
        config: { minutes: { kind: "value", value: 1 } },
      },
      {
        id: "wait",
        type: "delay",
        version: 1,
        name: "Wait",
        config: {
          until: { kind: "value", literalType: "instant", value: "2030-03-20T12:34:56.123000000Z" },
        },
      },
    ],
    edges: [
      { from: "start", to: "earlier", port: "next" },
      { from: "earlier", to: "wait", port: "next" },
    ],
  };
}
function target(definition: WorkflowDefinition, nodeId = "wait", path = ["until"]) {
  const result = describeMappingTarget(definition, nodeId, path);
  expect(result.state).toBe("ready");
  if (result.state !== "ready") throw new Error("Expected reviewed wait target");
  return result.target;
}

it("advertises fixed-instant waits as nonnullable instant literal-only targets", () => {
  const definition = graph();
  const before = structuredClone(definition);
  expect(target(definition)).toEqual({
    nodeId: "wait",
    path: ["until"],
    required: false,
    contract: { kind: "instant", nullable: false },
    mode: "literal-only",
  });
  expect(definition).toEqual(before);
});

it("rejects an actual upstream instant reference and cannot apply it to until", () => {
  const definition = graph();
  const before = structuredClone(definition);
  const raw = { kind: "reference", nodeId: "earlier", path: ["resumeAt"] };
  const described = target(definition);
  expect(inspectMapping(definition, "wait", described, raw)).toMatchObject({
    availability: "available",
    compatibility: "incompatible",
    runtimeChecks: [],
    issues: [{ nodeId: "wait", path: ["until"], code: "unsupported_setting" }],
  });
  expect(applyMappingSelection(definition, "wait", described, raw, undefined, true).ok).toBe(false);
  expect(definition).toEqual(before);
});

it("accepts an explicitly tagged instant literal while preserving its authored precision", () => {
  const definition = graph();
  const raw = definition.nodes[2]!.config.until;
  const before = structuredClone(raw);
  expect(inspectMapping(definition, "wait", target(definition), raw)).toMatchObject({
    compatibility: "compatible",
    issues: [],
    runtimeChecks: [],
  });
  expect(raw).toEqual(before);
});

it.each([
  { kind: "value", value: "2030-03-20T12:34:56Z" },
  { kind: "value", literalType: "date", value: "2030-03-20" },
  { kind: "value", literalType: "number", value: 60 },
])("requires instant expected-kind semantics for %j", (raw) => {
  const definition = graph();
  expect(inspectMapping(definition, "wait", target(definition), raw)).toMatchObject({
    compatibility: "incompatible",
    issues: [{ nodeId: "wait", path: ["until"], code: "invalid_type" }],
  });
});

it("keeps generic target inspection clock-free for a distant fixed instant", () => {
  const definition = graph();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    throw new Error("Static clock read");
  });
  try {
    const raw = { kind: "value", literalType: "instant", value: "9999-12-31T23:59:59.999Z" };
    expect(inspectMapping(definition, "wait", target(definition), raw).compatibility).toBe(
      "compatible",
    );
  } finally {
    clock.mockRestore();
  }
});

it("preserves the legacy minutes target and unrelated task binding modes", () => {
  const definition = graph();
  expect(target(definition, "earlier", ["minutes"])).toMatchObject({
    contract: { kind: "number", nullable: false },
    mode: "literal-only",
    required: true,
  });
  expect(target(mappingGraph(), "task", ["subject"])).toMatchObject({
    contract: { kind: "text", nullable: false },
    mode: "binding",
    required: true,
  });
});
