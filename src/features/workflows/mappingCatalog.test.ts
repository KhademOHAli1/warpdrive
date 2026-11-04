import { describe, expect, it } from "vitest";
import { conditionSourceDefaults } from "./configurationSpec";
import {
  mappingField,
  mappingFieldId,
  mappingGraph,
  mappingTarget,
  noMappingFields,
  reference,
} from "./mapping.test-helpers";
import {
  applyMappingSelection,
  describeMappingOutputs,
  describeMappingTarget,
  inspectMapping,
  legacyMappingTarget,
  mappingOutputForReference,
} from "./mappingCatalog";
import { describePaletteContext } from "./paletteContext";
import { actionRegistry } from "./registry";

describe("one qualified mapping catalog and current branch context", () => {
  it("describes the actual civil date, completed instant and existing owner identity", () => {
    const graph = mappingGraph();
    expect(actionRegistry["record.read"].outputs.expectedCloseDate).toBe("date");
    expect(actionRegistry.delay.outputs.resumeAt).toBe("instant");
    expect(
      mappingOutputForReference(graph, reference("read", "expectedCloseDate"))?.contract,
    ).toEqual({ kind: "date", nullable: true });
    expect(mappingOutputForReference(graph, reference("wait", "resumeAt"))?.contract).toEqual({
      kind: "instant",
      nullable: false,
    });
    expect(mappingOutputForReference(graph, reference("read", "ownerId"))?.contract).toEqual({
      kind: "entity",
      entity: "user",
      nullable: false,
    });
  });

  it("offers only actual upstream outputs and no self or downstream output", () => {
    const graph = mappingGraph();
    const catalog = describeMappingOutputs(graph, "task");
    expect(catalog.state).toBe("ready");
    expect([...new Set(catalog.outputs.map((output) => output.nodeId))]).toEqual([
      "start",
      "read",
      "check",
      "wait",
    ]);
    expect(catalog.outputs.some((output) => output.nodeId === "task")).toBe(false);
  });

  it("does not expose a sibling branch even when it has a declared ID output", () => {
    expect(
      describeMappingOutputs(mappingGraph(), "task").outputs.some(
        (output) => output.nodeId === "other",
      ),
    ).toBe(false);
  });

  it("does not offer a detached chain as an executable upstream path", () => {
    const graph = mappingGraph();
    graph.edges = graph.edges.filter((edge) => edge.from !== "start");
    expect(describeMappingOutputs(graph, "task").outputs).toEqual([]);
  });

  it("fails closed on malformed multiple incoming edges instead of choosing the first", () => {
    const graph = mappingGraph();
    graph.edges.push({ from: "other", to: "task", port: "next" });
    const catalog = describeMappingOutputs(graph, "task");
    expect(catalog.outputs).toEqual([]);
    expect(catalog.pathIssue).toBe("ambiguous-path");
  });

  it("fails closed when one source port ambiguously points at two destinations", () => {
    const graph = mappingGraph();
    graph.edges.push({ from: "check", to: "other", port: "true" });
    expect(describeMappingOutputs(graph, "task").outputs).toEqual([]);
    expect(describeMappingOutputs(graph, "task").pathIssue).toBe("ambiguous-path");
  });

  it("marks a supported incomplete source schema without claiming an actual value", () => {
    const graph = mappingGraph();
    const read = graph.nodes.find((node) => node.id === "read");
    if (read === undefined) throw new Error("Missing fixture source");
    delete read.config.recordId;
    const output = mappingOutputForReference(graph, reference("read", "title"));
    expect(output).toMatchObject({ nodeId: "read", path: ["title"], needsConfiguration: true });
    expect(output).not.toHaveProperty("value");
    expect(
      mappingOutputForReference(mappingGraph(), reference("read", "title")),
    ).not.toHaveProperty("needsConfiguration");
  });

  it("fails closed on an upstream cycle", () => {
    const graph = mappingGraph();
    graph.edges = graph.edges.filter((edge) => edge.to !== "read");
    graph.edges.push({ from: "task", to: "read", port: "next" });
    expect(describeMappingOutputs(graph, "task").outputs).toEqual([]);
  });

  it("does not bless a malformed source port", () => {
    const graph = mappingGraph();
    graph.edges[0]!.port = "true";
    expect(describeMappingOutputs(graph, "task").outputs).toEqual([]);
  });

  it("uses dependency paths rather than stored node-array order", () => {
    const graph = mappingGraph();
    const original = describeMappingOutputs(graph, "task").outputs;
    graph.nodes.reverse();
    expect(describeMappingOutputs(graph, "task").outputs).toEqual(original);
  });

  it("keeps stable reference keys on a source rename without changing the graph", () => {
    const graph = mappingGraph();
    const binding = reference("read", "title");
    const original = inspectMapping(graph, "task", mappingTarget(graph, ["subject"]), binding);
    graph.nodes.find((node) => node.id === "read")!.name = "خواندن معامله";
    const before = structuredClone(graph);
    expect(
      inspectMapping(graph, "task", mappingTarget(graph, ["subject"]), binding).source,
    ).toEqual(original.source);
    expect(graph).toEqual(before);
  });

  it("never promotes an unsupported source handler from its nominal registry outputs", () => {
    const graph = mappingGraph();
    const source = graph.nodes.find((node) => node.id === "read");
    if (source === undefined) throw new Error("Missing fixture source");
    source.type = "notification";
    source.config = { title: { kind: "value", value: "Notice" } };
    expect(
      describeMappingOutputs(graph, "task").outputs.some((output) => output.nodeId === "read"),
    ).toBe(false);
  });

  it("does not advertise non-deal read variants that have no qualified handler", () => {
    const graph = mappingGraph();
    graph.nodes.find((node) => node.id === "read")!.config.entity = "lead";
    expect(mappingOutputForReference(graph, reference("read", "id"))).toBeUndefined();
  });

  it("reports unavailable branch provenance even if the reference wire shape is valid", () => {
    const graph = mappingGraph();
    const result = inspectMapping(
      graph,
      "task",
      legacyMappingTarget("task", "text"),
      reference("other", "id"),
    );
    expect(result.availability).toBe("not-upstream");
    expect(result.compatibility).toBe("incompatible");
  });

  it("rejects unknown and prototype output paths", () => {
    const graph = mappingGraph();
    const target = mappingTarget(graph, ["subject"]);
    expect(inspectMapping(graph, "task", target, reference("read", "unknown")).availability).toBe(
      "unknown-output",
    );
    expect(
      inspectMapping(graph, "task", target, reference("read", "constructor")).issues.length,
    ).toBeGreaterThan(0);
  });

  it("keeps a deleted source reference for correction instead of rebinding it", () => {
    const graph = mappingGraph();
    const binding = reference("read", "title");
    graph.nodes = graph.nodes.filter((node) => node.id !== "read");
    const before = structuredClone(binding);
    expect(
      inspectMapping(graph, "task", legacyMappingTarget("task", "text"), binding).availability,
    ).toBe("source-missing");
    expect(binding).toEqual(before);
  });

  it("invalidates a changed source contract and restores it when the draft change is undone", () => {
    const graph = mappingGraph();
    const binding = reference("read", "id");
    const target = mappingTarget(graph, ["dealId"]);
    expect(inspectMapping(graph, "task", target, binding).compatibility).toBe("compatible");
    const original = structuredClone(graph);
    graph.nodes.find((node) => node.id === "read")!.config.entity = "lead";
    expect(inspectMapping(graph, "task", target, binding).compatibility).toBe("incompatible");
    expect(inspectMapping(original, "task", target, binding).compatibility).toBe("compatible");
  });

  it("derives temporal RHS intent and creates an incomplete explicit date default", () => {
    const graph = mappingGraph();
    graph.nodes.find((node) => node.id === "check")!.config.left = reference(
      "read",
      "expectedCloseDate",
    );
    const target = describeMappingTarget(graph, "check", ["right"]);
    expect(target.state).toBe("ready");
    if (target.state === "ready") expect(target.target.contract.kind).toBe("date");
    expect(conditionSourceDefaults({ type: "date", field: "expectedCloseDate" })).toEqual({
      operator: "equals",
      right: { kind: "value", value: "", literalType: "date" },
    });
  });

  it("requires current complete metadata for a new custom reference without deleting raw input", () => {
    const graph = mappingGraph();
    const raw = reference("read", "ownerId");
    const incomplete = { status: "incomplete" as const, defs: [mappingField("user")] };
    const target = describeMappingTarget(
      graph,
      "task",
      ["customFields", mappingFieldId],
      incomplete,
    );
    expect(target.state).toBe("unavailable");
    expect(raw).toEqual(reference("read", "ownerId"));
    expect(
      describeMappingOutputs(graph, "task", { status: "denied", defs: [mappingField("user")] })
        .outputs,
    ).toEqual([]);
  });

  it("applies one validated current selection immutably and rejects stale/readonly commands", () => {
    const graph = mappingGraph();
    const target = mappingTarget(graph, ["subject"]);
    const raw = reference("read", "title");
    const before = structuredClone(graph);
    const result = applyMappingSelection(graph, "task", target, raw, noMappingFields, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.definition.nodes.find((node) => node.id === "task")?.config.subject).toEqual(
        raw,
      );
      expect(result.definition.nodes.find((node) => node.id === "other")).toEqual(
        before.nodes.find((node) => node.id === "other"),
      );
      const again = applyMappingSelection(
        result.definition,
        "task",
        target,
        raw,
        noMappingFields,
        true,
      );
      expect(again.ok && again.changed).toBe(false);
    }
    expect(applyMappingSelection(graph, "task", target, raw, noMappingFields, false).ok).toBe(
      false,
    );
    const stale = structuredClone(graph);
    stale.nodes = stale.nodes.filter((node) => node.id !== "read");
    expect(applyMappingSelection(stale, "task", target, raw, noMappingFields, true).ok).toBe(false);
    expect(graph).toEqual(before);
  });

  it("keeps the original graph for the same reference regardless of JSON object-key order", () => {
    const graph = mappingGraph();
    const task = graph.nodes.find((node) => node.id === "task");
    if (task === undefined) throw new Error("Missing fixture task");
    task.config.subject = { kind: "reference", path: ["title"], nodeId: "read" };
    const before = structuredClone(graph);
    const result = applyMappingSelection(
      graph,
      "task",
      mappingTarget(graph, ["subject"]),
      reference("read", "title"),
      noMappingFields,
      true,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(false);
      expect(result.definition).toBe(graph);
    }
    expect(graph).toEqual(before);
  });

  it("uses the same qualified source descriptors in palette output context", () => {
    const context = describePaletteContext(mappingGraph(), {
      kind: "output",
      output: { from: "wait", port: "next" },
    });
    expect(context.sources).toContainEqual(
      expect.objectContaining({ nodeId: "read", path: ["expectedCloseDate"], valueType: "date" }),
    );
    expect(context.sources).toContainEqual(
      expect.objectContaining({ nodeId: "wait", path: ["resumeAt"], valueType: "instant" }),
    );
  });

  it("does not advertise unsupported read-entity outputs through the palette adapter", () => {
    const graph = mappingGraph();
    graph.nodes.find((node) => node.id === "read")!.config.entity = "lead";
    const context = describePaletteContext(graph, {
      kind: "output",
      output: { from: "read", port: "next" },
    });
    expect(context.sources.some((source) => source.nodeId === "read")).toBe(false);
  });

  it("does not advertise an ambiguous upstream palette path", () => {
    const graph = mappingGraph();
    graph.edges.push({ from: "other", to: "read", port: "next" });
    expect(
      describePaletteContext(graph, { kind: "output", output: { from: "read", port: "next" } })
        .sources,
    ).toEqual([]);
  });
});
