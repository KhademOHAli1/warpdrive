import { describe, expect, it } from "vitest";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../schemas";
import { type ComparableVersion, comparePublishedVersions } from "./publishedVersionDiff";

function node(id: string, name = id, config: WorkflowNode["config"] = {}): WorkflowNode {
  return { id, name, type: "trigger.manual", version: 1, config };
}
function version(
  nodes = [node("start")],
  edges: WorkflowEdge[] = [],
  layout?: WorkflowDefinition["layout"],
): ComparableVersion {
  return {
    name: "Workflow",
    definition: { schemaVersion: 1, nodes, edges, ...(layout === undefined ? {} : { layout }) },
  };
}
function edge(from: string, to: string, port: WorkflowEdge["port"] = "next"): WorkflowEdge {
  return { from, to, port };
}
function unavailable(before: ComparableVersion, after: ComparableVersion) {
  expect(() => comparePublishedVersions(before, after)).toThrow(
    "Published version comparison unavailable",
  );
}

describe("published version comparison projection", () => {
  it("reports an unchanged immutable publication without modifying either input", () => {
    const before = version([node("start", "Start", { value: "synthetic-value" })]);
    const after = structuredClone(before);
    const beforeBytes = JSON.stringify(before);
    const afterBytes = JSON.stringify(after);
    Object.freeze(before.definition.nodes);
    Object.freeze(before.definition.nodes[0]?.config);
    Object.freeze(after.definition.nodes);
    const result = comparePublishedVersions(before, after);
    expect(result.unchanged).toBe(true);
    expect(result.changedSteps).toHaveLength(0);
    expect(JSON.stringify(before) === beforeBytes).toBe(true);
    expect(JSON.stringify(after) === afterBytes).toBe(true);
  });

  it("ignores node-array and nested object-key order", () => {
    const before = version([
      node("start", "Start", { first: 1, second: { a: true, b: "x" } }),
      node("finish", "Finish"),
    ]);
    const after = version([
      node("finish", "Finish"),
      node("start", "Start", { second: { b: "x", a: true }, first: 1 }),
    ]);
    expect(comparePublishedVersions(before, after).unchanged).toBe(true);
  });

  it("retains array order inside settings", () => {
    const before = version([node("start", "Start", { order: ["alpha", "beta"] })]);
    const after = version([node("start", "Start", { order: ["beta", "alpha"] })]);
    const result = comparePublishedVersions(before, after);
    expect(result.unchanged).toBe(false);
    expect(result.changedSteps.map((step) => step.configurationChanged)).toEqual([true]);
  });

  it("signals a literal-only change without returning settings, keys, node IDs or bindings", () => {
    const before = version([
      node("private_graph_identifier", "Authorized name", {
        NEVER_PROJECT_THIS_KEY: {
          kind: "reference",
          nodeId: "PRIVATE_REFERENCE",
          path: ["PRIVATE_PATH"],
        },
      }),
    ]);
    const after = version([
      node("private_graph_identifier", "Authorized name", {
        NEVER_PROJECT_THIS_KEY: { kind: "value", value: "NEVER_PROJECT_THIS_VALUE" },
      }),
    ]);
    const result = comparePublishedVersions(before, after);
    expect(result.changedSteps[0]?.configurationChanged).toBe(true);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "NEVER_PROJECT_THIS_KEY",
      "NEVER_PROJECT_THIS_VALUE",
      "PRIVATE_REFERENCE",
      "PRIVATE_PATH",
      "private_graph_identifier",
    ]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
    expect(Object.keys(result.changedSteps[0] ?? {}).sort()).toEqual([
      "afterName",
      "beforeName",
      "configurationChanged",
      "kindChanged",
      "nameChanged",
      "namingChanged",
      "ordinal",
      "versionChanged",
    ]);
  });

  it("separates diagram-only changes from step and connection changes", () => {
    const before = version([node("start")], [], { start: { x: 0, y: 0 } });
    const after = version([node("start")], [], { start: { x: 40, y: 120 } });
    const result = comparePublishedVersions(before, after);
    expect(result.layoutChanged).toBe(true);
    expect(result.changedSteps).toHaveLength(0);
    expect(result.addedConnections).toHaveLength(0);
    expect(result.removedConnections).toHaveLength(0);
  });

  it("treats missing and empty layout maps as equivalent", () => {
    expect(comparePublishedVersions(version(), version([node("start")], [], {})).unchanged).toBe(
      true,
    );
  });

  it("reports workflow naming independently", () => {
    const result = comparePublishedVersions(version(), { ...version(), name: "Renamed workflow" });
    expect(result.nameChanged).toBe(true);
    expect(result.changedSteps).toHaveLength(0);
  });

  it("matches stable node identity even when the name changes", () => {
    const result = comparePublishedVersions(
      version([node("start", "Before")]),
      version([node("start", "After")]),
    );
    expect(
      result.changedSteps.map((step) => ({
        before: step.beforeName,
        after: step.afterName,
        changed: step.nameChanged,
      })),
    ).toEqual([{ before: "Before", after: "After", changed: true }]);
    expect(result.addedSteps).toHaveLength(0);
    expect(result.removedSteps).toHaveLength(0);
  });

  it("does not match different node identities merely because their names agree", () => {
    const result = comparePublishedVersions(
      version([node("old", "Same name")]),
      version([node("new", "Same name")]),
    );
    expect(result.addedSteps.map((step) => step.name)).toEqual(["Same name"]);
    expect(result.removedSteps.map((step) => step.name)).toEqual(["Same name"]);
    expect(result.changedSteps).toHaveLength(0);
  });

  it("projects added/removed steps and their connection endpoints using authorized names", () => {
    const before = version(
      [node("start", "Start"), node("old", "Old step")],
      [edge("start", "old")],
    );
    const after = version(
      [node("start", "Start"), node("new", "New step")],
      [edge("start", "new")],
    );
    const result = comparePublishedVersions(before, after);
    expect(result.addedSteps).toEqual([{ ordinal: 0, name: "New step" }]);
    expect(result.removedSteps).toEqual([{ ordinal: 0, name: "Old step" }]);
    expect(result.addedConnections).toEqual([
      { ordinal: 0, fromName: "Start", toName: "New step", port: "next" },
    ]);
    expect(result.removedConnections).toEqual([
      { ordinal: 0, fromName: "Start", toName: "Old step", port: "next" },
    ]);
  });

  it("distinguishes step action, version and naming-mode changes without raw action payloads", () => {
    const before = version([node("start", "Start")]);
    const changed = {
      ...node("start", "Start"),
      type: "record.read",
      nameMode: "custom",
    } satisfies WorkflowNode;
    Reflect.set(changed, "version", 2);
    const result = comparePublishedVersions(before, version([changed]));
    expect(
      result.changedSteps.map((step) => [
        step.kindChanged,
        step.versionChanged,
        step.namingChanged,
        step.configurationChanged,
      ]),
    ).toEqual([[true, true, true, false]]);
    expect(JSON.stringify(result).includes("record.read")).toBe(false);
  });

  it("ignores edge-array order", () => {
    const nodes = [node("start"), node("middle"), node("end")];
    const one = edge("start", "middle");
    const two = edge("middle", "end");
    expect(
      comparePublishedVersions(version(nodes, [one, two]), version(nodes, [two, one])).unchanged,
    ).toBe(true);
  });

  it("treats changed ports as a removal and addition", () => {
    const nodes = [node("start"), node("end")];
    const result = comparePublishedVersions(
      version(nodes, [edge("start", "end", "true")]),
      version(nodes, [edge("start", "end", "false")]),
    );
    expect(result.removedConnections.map((item) => item.port)).toEqual(["true"]);
    expect(result.addedConnections.map((item) => item.port)).toEqual(["false"]);
  });

  it("preserves legacy duplicate-edge multiplicity and duplicate display names", () => {
    const nodes = [node("start", "Duplicate"), node("end", "Duplicate")];
    const connection = edge("start", "end");
    const result = comparePublishedVersions(
      version(nodes, [connection, connection]),
      version(nodes, [connection]),
    );
    expect(result.removedConnections).toEqual([
      { ordinal: 0, fromName: "Duplicate", toName: "Duplicate", port: "next" },
    ]);
    expect(result.addedConnections).toHaveLength(0);
  });

  it("uses separate presentation ordinals for repeated connection additions", () => {
    const nodes = [node("start"), node("end")];
    const connection = edge("start", "end");
    const result = comparePublishedVersions(
      version(nodes),
      version(nodes, [connection, connection]),
    );
    expect(result.addedConnections.map((item) => item.ordinal)).toEqual([0, 1]);
  });

  it("handles deeply nested retained JSON without recursive comparison", () => {
    function deep(): WorkflowNode["config"] {
      let value: WorkflowNode["config"] = { leaf: "same" };
      for (let depth = 0; depth < 2500; depth++) value = { child: value };
      return value;
    }
    expect(
      comparePublishedVersions(
        version([node("start", "Start", deep())]),
        version([node("start", "Start", deep())]),
      ).unchanged,
    ).toBe(true);
  });

  it("rejects duplicate node IDs instead of overwriting historical identity", () => {
    unavailable(version(), version([node("start"), node("start", "Other name")]));
  });

  it("rejects missing node IDs without echoing the retained payload", () => {
    const invalid = version();
    Reflect.deleteProperty(invalid.definition.nodes[0]!, "id");
    unavailable(version(), invalid);
  });

  it("rejects dangling edge endpoints rather than inventing names", () => {
    unavailable(version(), version([node("start")], [edge("start", "missing")]));
  });

  it("rejects a malformed null node through the generic error fence", () => {
    const invalid = version();
    Reflect.set(invalid.definition.nodes, 0, null);
    unavailable(version(), invalid);
  });

  it("rejects unsupported retained values through the generic error fence", () => {
    const invalid = version();
    Reflect.set(invalid.definition.nodes[0]!.config, "hidden", new Date("2026-11-05T00:00:00Z"));
    unavailable(version(), invalid);
  });

  it("bounds work on excessive retained settings", () => {
    unavailable(
      version(),
      version([node("start", "Start", { values: Array.from({ length: 100_001 }, () => null) })]),
    );
  });

  it("retains the graph's maximum node bound", () => {
    unavailable(
      version(),
      version(Array.from({ length: 101 }, (_, index) => node(`node_${index}`))),
    );
  });

  it("retains the graph's maximum edge bound", () => {
    const nodes = [node("start"), node("end")];
    unavailable(
      version(),
      version(
        nodes,
        Array.from({ length: 201 }, () => edge("start", "end")),
      ),
    );
  });

  it("rejects a schema-only historical change rather than claiming no change", () => {
    const invalid = version();
    Reflect.set(invalid.definition, "schemaVersion", 2);
    unavailable(version(), invalid);
  });

  it("rejects a missing retained schema version", () => {
    const invalid = version();
    Reflect.deleteProperty(invalid.definition, "schemaVersion");
    unavailable(version(), invalid);
  });

  it.each([
    {
      label: "root",
      mutate: (value: ComparableVersion) => Reflect.set(value.definition, "extra", true),
    },
    {
      label: "node",
      mutate: (value: ComparableVersion) => Reflect.set(value.definition.nodes[0]!, "extra", true),
    },
    {
      label: "edge",
      mutate: (value: ComparableVersion) => Reflect.set(value.definition.edges[0]!, "extra", true),
    },
  ])("rejects ignored unknown $label fields", ({ mutate }) => {
    const invalid = version([node("start"), node("end")], [edge("start", "end")]);
    mutate(invalid);
    unavailable(version(), invalid);
  });

  it.each([
    { label: "null", layout: null },
    { label: "scalar", layout: 42 },
    { label: "array", layout: [] },
    { label: "missing coordinate", layout: { start: { x: 0 } } },
    { label: "extra coordinate", layout: { start: { x: 0, y: 0, z: 0 } } },
    { label: "non-number coordinate", layout: { start: { x: "hidden-coordinate", y: 0 } } },
    { label: "non-finite coordinate", layout: { start: { x: Number.POSITIVE_INFINITY, y: 0 } } },
    { label: "out-of-range coordinate", layout: { start: { x: 100_001, y: 0 } } },
    { label: "invalid identifier", layout: { "1invalid": { x: 0, y: 0 } } },
  ])("rejects $label layout through the generic error fence", ({ layout }) => {
    const invalid = version();
    Reflect.set(invalid.definition, "layout", layout);
    unavailable(version(), invalid);
  });

  it("retains the layout map's maximum entry bound", () => {
    const layout: NonNullable<WorkflowDefinition["layout"]> = {};
    for (let index = 0; index < 101; index++) layout[`position_${index}`] = { x: 0, y: 0 };
    unavailable(version(), version([node("start")], [], layout));
  });

  it("preserves valid extra layout entries allowed by the canonical definition schema", () => {
    const before = version([node("start")], [], { detached: { x: -100_000, y: 100_000 } });
    const after = version([node("start")], [], { detached: { x: -100_000, y: 100_000 } });
    expect(comparePublishedVersions(before, after).unchanged).toBe(true);
  });
});
