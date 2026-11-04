import { describe, expect, it } from "vitest";
import { mappingGraph, reference } from "./mapping.test-helpers";
import { inspectMapping, legacyMappingTarget } from "./mappingCatalog";
import { buildMappingPreview } from "./mappingPreview";

describe("literal truth and synthetic reference preview boundary", () => {
  it("distinguishes omitted, explicit null, false, zero and empty text", () => {
    const graph = mappingGraph();
    const target = legacyMappingTarget("task", "scalar", { nullable: true });
    const absent = buildMappingPreview(undefined, inspectMapping(graph, "task", target, undefined));
    expect(absent).toMatchObject({ state: "literal", presence: "omitted" });
    for (const value of [null, false, 0, ""]) {
      const raw = { kind: "value", value };
      const preview = buildMappingPreview(raw, inspectMapping(graph, "task", target, raw));
      expect(preview).toMatchObject({
        state: "literal",
        presence: value === null ? "null" : "value",
        value,
      });
    }
  });

  it("shows invalid numeric raw input with its intent rather than text or a last-valid value", () => {
    const graph = mappingGraph();
    const target = legacyMappingTarget("task", "scalar");
    const raw = { kind: "value", value: "-", literalType: "number" };
    expect(buildMappingPreview(raw, inspectMapping(graph, "task", target, raw))).toMatchObject({
      state: "literal",
      presence: "value",
      intent: "number",
      value: "-",
      valid: false,
    });
    const text = { kind: "value", value: "2030-03-20" };
    expect(buildMappingPreview(text, inspectMapping(graph, "task", target, text))).toMatchObject({
      state: "literal",
      intent: "text",
      value: text.value,
    });
  });

  it("labels a real civil-date source example synthetic and its nullable value runtime-only", () => {
    const graph = mappingGraph();
    const raw = reference("read", "expectedCloseDate");
    const target = legacyMappingTarget("task", "scalar");
    const preview = buildMappingPreview(raw, inspectMapping(graph, "task", target, raw));
    expect(preview).toMatchObject({
      state: "reference",
      possibleNull: true,
      runtimeOnly: true,
      source: { nodeId: "read", path: ["expectedCloseDate"] },
      example: { synthetic: true, kind: "date" },
    });
    expect(preview).not.toHaveProperty("actualValue");
  });

  it("never invents a user UUID as an identity example", () => {
    const graph = mappingGraph();
    const raw = reference("read", "ownerId");
    const preview = buildMappingPreview(
      raw,
      inspectMapping(graph, "task", legacyMappingTarget("task", "scalar"), raw),
    );
    expect(preview).toMatchObject({
      state: "reference",
      example: { synthetic: true, kind: "entity" },
    });
    if (preview.state === "reference") expect(preview.example.value).toBeUndefined();
  });

  it("replaces missing-source preview content without repairing the saved binding", () => {
    const graph = mappingGraph();
    const raw = reference("read", "title");
    graph.nodes = graph.nodes.filter((node) => node.id !== "read");
    const preview = buildMappingPreview(
      raw,
      inspectMapping(graph, "task", legacyMappingTarget("task", "text"), raw),
    );
    expect(preview).toMatchObject({ state: "unavailable", reason: "source-missing" });
    expect(preview).not.toHaveProperty("example");
    expect(raw).toEqual(reference("read", "title"));
  });

  it("keeps preview examples detached from all graph and binding payloads", () => {
    const graph = mappingGraph();
    const raw = reference("wait", "resumeAt");
    const beforeGraph = structuredClone(graph);
    const beforeRaw = structuredClone(raw);
    const preview = buildMappingPreview(
      raw,
      inspectMapping(graph, "task", legacyMappingTarget("task", "text"), raw),
    );
    expect(preview.state).toBe("reference");
    expect(graph).toEqual(beforeGraph);
    expect(raw).toEqual(beforeRaw);
    expect(raw).not.toHaveProperty("value");
  });
});
