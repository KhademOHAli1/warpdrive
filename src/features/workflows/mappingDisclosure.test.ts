import { describe, expect, it } from "vitest";
import {
  mappingField,
  mappingGraph,
  mappingTarget,
  noMappingFields,
  reference,
} from "./mapping.test-helpers";
import {
  applyMappingSelection,
  describeMappingOutputs,
  inspectMapping,
  legacyMappingTarget,
} from "./mappingCatalog";
import { buildMappingPreview } from "./mappingPreview";

describe("mapping metadata and authored-value disclosure boundaries", () => {
  it("excludes source configuration and literal record identifiers from catalog descriptors", () => {
    const graph = mappingGraph();
    const source = graph.nodes.find((node) => node.id === "read");
    if (source === undefined) throw new Error("Expected read fixture");
    const privateId = "2b4be9ee-d938-41e5-91b6-05ca6bccb528";
    source.config.recordId = { kind: "value", value: privateId };
    const catalog = describeMappingOutputs(graph, "task");
    expect(catalog.outputs.length).toBeGreaterThan(0);
    expect(JSON.stringify(catalog)).not.toContain(privateId);
    for (const output of catalog.outputs) expect(output).not.toHaveProperty("config");
  });

  it("withholds cached field labels and option data after confirmed metadata denial", () => {
    const graph = mappingGraph();
    const field = mappingField("single_option");
    field.name = "Private cached field label";
    field.options = [{ id: "private-option", label: "Private cached option label" }];
    const catalog = describeMappingOutputs(graph, "task", { status: "denied", defs: [field] });
    expect(catalog).toMatchObject({ state: "denied", outputs: [] });
    expect(JSON.stringify(catalog)).not.toContain(field.name);
    expect(JSON.stringify(catalog)).not.toContain("Private cached option label");
  });

  it("reports invalid typed input through safe issues without echoing authored text", () => {
    const graph = mappingGraph();
    const privateValue = "private invalid numeric draft";
    const inspection = inspectMapping(graph, "task", legacyMappingTarget("task", "scalar"), {
      kind: "value",
      value: privateValue,
      literalType: "number",
    });
    expect(inspection.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(inspection.issues)).not.toContain(privateValue);
  });

  it("reports an unknown output through safe target issues without echoing its path", () => {
    const graph = mappingGraph();
    const privatePath = "privateUnavailableField";
    const inspection = inspectMapping(
      graph,
      "task",
      legacyMappingTarget("task", "scalar"),
      reference("read", privatePath),
    );
    expect(inspection.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(inspection.issues)).not.toContain(privatePath);
  });

  it("rejects a reference carrying an unreviewed payload without rendering it as a preview", () => {
    const graph = mappingGraph();
    const privateValue = "unreviewed attached CRM payload";
    const raw = { ...reference("read", "title"), value: privateValue };
    const inspection = inspectMapping(graph, "task", legacyMappingTarget("task", "text"), raw);
    const preview = buildMappingPreview(raw, inspection);
    expect(inspection.issues.length).toBeGreaterThan(0);
    expect(preview.state).toBe("unavailable");
    expect(JSON.stringify(preview)).not.toContain(privateValue);
  });

  it("commits only the selected stable reference and never a preview example", () => {
    const graph = mappingGraph();
    const target = mappingTarget(graph, ["subject"]);
    const binding = reference("read", "expectedCloseDate");
    const preview = buildMappingPreview(binding, inspectMapping(graph, "task", target, binding));
    expect(preview.state).toBe("reference");
    const selected = applyMappingSelection(graph, "task", target, binding, noMappingFields, true);
    expect(selected.ok).toBe(true);
    if (!selected.ok) throw new Error("Expected a current allowed selection");
    const saved = selected.definition.nodes.find((node) => node.id === "task")?.config.subject;
    expect(saved).toStrictEqual(binding);
    expect(JSON.stringify(selected.definition)).not.toContain('"synthetic"');
    expect(JSON.stringify(selected.definition)).not.toContain('"example"');
  });
});
