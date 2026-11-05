import { assert, describe, expect, it } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import {
  boundedDraftSimulationJson,
  draftSimulationInputLimits,
  prepareDraftSimulationInput,
} from "./draftSimulationInput";
import type { WorkflowDefinition } from "./schemas";

const workflowId = "13954be0-8707-4c69-b427-900ae0dbab05";
const recordId = "678abacf-14cb-4428-8420-3d7f8dca14ae";
const invalid = { ok: false, error: ERROR_IDS.WORKFLOW_INVALID };

function definition(): WorkflowDefinition {
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
      {
        id: "task",
        type: "activity.create",
        version: 1,
        name: "Task",
        config: {
          subject: { kind: "value", value: "Private authored task" },
          dealId: { kind: "reference", nodeId: "read", path: ["id"] },
        },
      },
    ],
    edges: [
      { from: "start", to: "read", port: "next" },
      { from: "read", to: "task", port: "next" },
    ],
  };
}

function input(draft = definition()) {
  return { workflowId, recordId, definition: draft };
}

function nested(depth: number): unknown {
  let result: unknown = 0;
  for (let level = 0; level < depth; level++) result = [result];
  return result;
}

describe("draft simulation input preparation", () => {
  it("preserves an owned raw-order authored cut independently of parsed names and later caller mutation", () => {
    const graph = definition();
    graph.nodes[0]!.name = "  Authored start  ";
    const authored: WorkflowDefinition = {
      edges: graph.edges,
      nodes: graph.nodes,
      schemaVersion: graph.schemaVersion,
    };
    const capturedJson = JSON.stringify(authored);
    const result = prepareDraftSimulationInput(input(authored));
    assert(result.ok, JSON.stringify(result));
    expect(JSON.stringify(result.value.authoredDefinition)).toBe(capturedJson);
    expect(result.value.definition.nodes[0]?.name).toBe("Authored start");
    expect(JSON.stringify(result.value.definition)).not.toBe(capturedJson);
    authored.nodes[2]!.config.subject = { kind: "value", value: "Later local edit" };
    expect(JSON.stringify(result.value.authoredDefinition)).toBe(capturedJson);
    expect(result.value.definition.nodes[2]?.config.subject).toEqual({
      kind: "value",
      value: "Private authored task",
    });
  });

  it("accepts acyclic shared authored aliases and retains their exact expanded JSON meaning", () => {
    const graph = definition();
    const position = { x: 12, y: 34 };
    graph.layout = { start: position, read: position };
    const result = prepareDraftSimulationInput(input(graph));
    assert(result.ok, JSON.stringify(result));
    expect(JSON.stringify(result.value.authoredDefinition)).toBe(JSON.stringify(graph));
    expect(result.value.definition.layout).toEqual({
      start: { x: 12, y: 34 },
      read: { x: 12, y: 34 },
    });
  });

  it("normalizes context UUID spelling without changing the authored definition", () => {
    const graph = definition();
    const result = prepareDraftSimulationInput({
      workflowId: workflowId.toUpperCase(),
      recordId: recordId.toUpperCase(),
      definition: graph,
    });
    assert(result.ok, JSON.stringify(result));
    expect(result.value.workflowId).toBe(workflowId);
    expect(result.value.recordId).toBe(recordId);
    expect(JSON.stringify(result.value.authoredDefinition)).toBe(JSON.stringify(graph));
  });

  it.each([
    { label: "null envelope", make: () => null },
    { label: "array envelope", make: () => [] },
    { label: "missing definition", make: () => ({ workflowId, recordId }) },
    { label: "extra authority field", make: () => ({ ...input(), actorId: workflowId }) },
    { label: "invalid workflow UUID", make: () => ({ ...input(), workflowId: "invalid" }) },
    { label: "invalid record UUID", make: () => ({ ...input(), recordId: "invalid" }) },
    { label: "null definition", make: () => ({ ...input(), definition: null }) },
  ])("rejects a $label through a bounded known input result", ({ make }) => {
    expect(prepareDraftSimulationInput(make())).toEqual(invalid);
  });

  it("refuses an accessor-bearing envelope without invoking its definition getter", () => {
    let reads = 0;
    const value = input();
    Object.defineProperty(value, "definition", {
      enumerable: true,
      get: () => {
        reads++;
        return definition();
      },
    });
    expect(prepareDraftSimulationInput(value)).toEqual(invalid);
    expect(reads).toBe(0);
  });

  it("refuses an authored configuration accessor before schema parsing can invoke it", () => {
    let reads = 0;
    const graph = definition();
    Object.defineProperty(graph.nodes[2]!.config, "subject", {
      enumerable: true,
      get: () => {
        reads++;
        return { kind: "value", value: "Private getter" };
      },
    });
    expect(prepareDraftSimulationInput(input(graph))).toEqual(invalid);
    expect(reads).toBe(0);
  });

  it("refuses a hidden toJSON hook without invoking it", () => {
    let serializations = 0;
    const graph = definition();
    Object.defineProperty(graph, "toJSON", {
      enumerable: false,
      value: () => {
        serializations++;
        return definition();
      },
    });
    expect(prepareDraftSimulationInput(input(graph))).toEqual(invalid);
    expect(serializations).toBe(0);
  });

  it("rejects cycles before the recursive definition parser or JSON serialization", () => {
    const graph = definition();
    Object.assign(graph.nodes[2]!.config, { cycle: graph });
    expect(prepareDraftSimulationInput(input(graph))).toEqual(invalid);
  });

  it("rejects a graph with more than the canonical hundred-node limit", () => {
    const graph = definition();
    graph.nodes.push(
      ...Array.from({ length: 98 }, (_, index) => ({
        id: "extra_" + index,
        type: "activity.create" as const,
        version: 1 as const,
        name: "Extra task",
        config: { subject: { kind: "value", value: "Bounded" } },
      })),
    );
    expect(prepareDraftSimulationInput(input(graph))).toEqual(invalid);
  });

  it.each(["dangling edge", "duplicate node", "cycle"] as const)(
    "rejects a structurally invalid %s graph",
    (problem) => {
      const graph = definition();
      if (problem === "dangling edge") graph.edges[0]!.to = "missing";
      else if (problem === "duplicate node") graph.nodes[2]!.id = "read";
      else graph.edges.push({ from: "task", to: "read", port: "next" });
      expect(prepareDraftSimulationInput(input(graph))).toEqual(invalid);
    },
  );
});

describe("expanded authored JSON budget", () => {
  it("rejects non-JSON leaves and host objects", () => {
    const unsupported: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      BigInt(1),
      () => true,
      Symbol("private"),
      new Date(),
      new Map(),
      new Set(),
    ];
    for (const value of unsupported) expect(boundedDraftSimulationJson(value)).toBe(false);
  });

  it("rejects sparse arrays and named array properties", () => {
    expect(boundedDraftSimulationJson(new Array(2))).toBe(false);
    const decorated = [1, 2];
    Object.assign(decorated, { private: "extra" });
    expect(boundedDraftSimulationJson(decorated)).toBe(false);
  });

  it("rejects hidden properties and symbol keys", () => {
    const hidden = { ordinary: true };
    Object.defineProperty(hidden, "private", { enumerable: false, value: "hidden" });
    expect(boundedDraftSimulationJson(hidden)).toBe(false);
    const symbolic = { [Symbol("private")]: "hidden" };
    expect(boundedDraftSimulationJson(symbolic)).toBe(false);
  });

  it("accepts ordinary finite JSON values", () => {
    expect(
      boundedDraftSimulationJson({
        nullable: null,
        flag: false,
        zero: 0,
        negativeZero: -0,
        values: ["", 1.5, true],
      }),
    ).toBe(true);
  });

  it.each([
    { depth: draftSimulationInputLimits.depth, valid: true },
    { depth: draftSimulationInputLimits.depth + 1, valid: false },
  ])("enforces depth $depth with valid=$valid", ({ depth, valid }) => {
    expect(boundedDraftSimulationJson(nested(depth))).toBe(valid);
  });

  it.each([
    { children: draftSimulationInputLimits.entries - 1, valid: true },
    { children: draftSimulationInputLimits.entries, valid: false },
  ])(
    "enforces expanded entries for $children children with valid=$valid",
    ({ children, valid }) => {
      expect(boundedDraftSimulationJson(Array.from({ length: children }, () => null))).toBe(valid);
    },
  );

  it.each([
    { units: draftSimulationInputLimits.textUnits, valid: true },
    { units: draftSimulationInputLimits.textUnits + 1, valid: false },
  ])("enforces $units total text units with valid=$valid", ({ units, valid }) => {
    expect(boundedDraftSimulationJson("x".repeat(units))).toBe(valid);
  });

  it("budgets repeated alias expansion rather than merely counting distinct objects", () => {
    let shared: unknown = 0;
    for (let depth = 0; depth < 16; depth++) shared = [shared, shared];
    expect(boundedDraftSimulationJson(shared)).toBe(false);
  });
});
