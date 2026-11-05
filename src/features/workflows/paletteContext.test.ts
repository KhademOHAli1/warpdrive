import { expect, it, vi } from "vitest";
import { initialBlankDefinition } from "./editorModel";
import type { CreatableNodeType } from "./nodeFactory";
import { describePaletteContext, type PaletteContext, selectPaletteEntry } from "./paletteContext";
import { definitionSchema, type WorkflowDefinition, type WorkflowNode } from "./schemas";

function branch(): WorkflowDefinition {
  const graph = initialBlankDefinition("Start");
  const read = (id: string): WorkflowNode => ({
    id,
    type: "record.read",
    version: 1,
    name: id,
    config: {
      entity: "deal",
      recordId: { kind: "reference", nodeId: "start", path: ["recordId"] },
    },
  });
  graph.nodes.push(
    {
      id: "gate",
      type: "condition",
      version: 1,
      name: "Check",
      config: {
        left: { kind: "reference", nodeId: "start", path: ["recordId"] },
        operator: "exists",
      },
    },
    read("read_true"),
    read("read_false"),
    read("later"),
  );
  graph.edges = [
    { from: "start", to: "gate", port: "next" },
    { from: "gate", to: "read_true", port: "true" },
    { from: "gate", to: "read_false", port: "false" },
    { from: "read_true", to: "later", port: "next" },
  ];
  return graph;
}
function options() {
  return {
    editable: true,
    metadataConfirmed: true,
    newNodeId: "inserted",
    selectedId: "start",
    nameForType: vi.fn<(type: CreatableNodeType) => string>().mockReturnValue("New step"),
    subject: "Call",
  };
}
function entry(context: PaletteContext, type: WorkflowNode["type"]) {
  const found = context.entries.find((item) => item.type === type);
  if (found === undefined) throw new Error("Missing reviewed context entry");
  return found;
}

it("does not invent upstream sources for detached insertion", () => {
  const context = describePaletteContext(branch(), { kind: "detached" });
  expect(context).toMatchObject({
    source: null,
    output: null,
    occupiedDestinationId: null,
    sources: [],
  });
  expect(entry(context, "record.read").input).toEqual({ state: "needs-mapping", sources: [] });
  expect(entry(context, "condition").input.state).toBe("needs-mapping");
  expect(entry(context, "activity.create").input.state).toBe("not-required");
  expect(entry(context, "delay").input.state).toBe("not-required");
});

it("includes the selected output source and its actual ancestors", () => {
  const context = describePaletteContext(branch(), {
    kind: "output",
    output: { from: "read_true", port: "next" },
  });
  expect(context.source).toEqual({ id: "read_true", type: "record.read", version: 1 });
  expect(context.occupiedDestinationId).toBe("later");
  expect(new Set(context.sources.map((source) => source.nodeId))).toEqual(
    new Set(["start", "gate", "read_true"]),
  );
  expect(entry(context, "condition").input.sources).toContainEqual({
    nodeId: "gate",
    path: ["result"],
    valueType: "boolean",
    semantic: "scalar",
  });
});

it("requires semantic deal identity rather than arbitrary string outputs", () => {
  const context = describePaletteContext(branch(), {
    kind: "output",
    output: { from: "read_true", port: "next" },
  });
  expect(entry(context, "record.read").input.sources).toEqual([
    { nodeId: "start", path: ["recordId"], valueType: "string", semantic: "deal-id" },
    { nodeId: "read_true", path: ["id"], valueType: "string", semantic: "deal-id" },
  ]);
  expect(
    entry(context, "record.read").input.sources.some((source) => source.path[0] === "title"),
  ).toBe(false);
  const graph = branch();
  const source = graph.nodes.find((node) => node.id === "read_true");
  if (source === undefined) throw new Error("Missing fixture source");
  source.config.entity = "person";
  expect(
    entry(
      describePaletteContext(graph, {
        kind: "output",
        output: { from: "read_true", port: "next" },
      }),
      "record.read",
    ).input.sources.map((item) => item.nodeId),
  ).toEqual(["start"]);
});

it("excludes sibling-branch values even if the graph array places them last", () => {
  const graph = branch();
  graph.nodes.reverse();
  const context = describePaletteContext(graph, {
    kind: "output",
    output: { from: "read_false", port: "next" },
  });
  expect(context.sources.some((source) => ["read_true", "later"].includes(source.nodeId))).toBe(
    false,
  );
  const result = selectPaletteEntry(
    graph,
    { kind: "output", output: { from: "read_false", port: "next" } },
    { kind: "insert", type: "condition", version: 1 },
    options(),
  );
  if (!result.ok) throw new Error("Expected branch insertion");
  expect(result.definition.nodes.find((node) => node.id === "inserted")?.config.left).toEqual({
    kind: "reference",
    nodeId: "read_false",
    path: ["status"],
  });
});

it("never presents descendant values as inputs before the selected step", () => {
  const context = describePaletteContext(branch(), {
    kind: "output",
    output: { from: "gate", port: "true" },
  });
  expect(new Set(context.sources.map((source) => source.nodeId))).toEqual(
    new Set(["start", "gate"]),
  );
  expect(
    context.sources.some(
      (source) => source.nodeId.startsWith("read_") || source.nodeId === "later",
    ),
  ).toBe(false);
});

it("preserves occupied-output linear splicing and refuses a branching condition there", () => {
  const graph = branch();
  const request = { kind: "output" as const, output: { from: "start", port: "next" as const } };
  const context = describePaletteContext(graph, request);
  expect(entry(context, "condition").reason).toBe("invalidPort");
  for (const type of ["record.read", "activity.create", "delay"] as const)
    expect(entry(context, type).reason).toBeNull();
  expect(
    selectPaletteEntry(
      graph,
      request,
      { kind: "insert", type: "condition", version: 1 },
      options(),
    ),
  ).toEqual({ ok: false, reason: "invalidPort" });
  const result = selectPaletteEntry(
    graph,
    request,
    { kind: "insert", type: "delay", version: 1 },
    options(),
  );
  if (!result.ok) throw new Error("Expected linear insertion");
  expect(result.changed).toBe(true);
  expect(result.definition.edges).toContainEqual({ from: "start", to: "inserted", port: "next" });
  expect(result.definition.edges).toContainEqual({ from: "inserted", to: "gate", port: "next" });
  expect(result.definition.edges).not.toContainEqual({ from: "start", to: "gate", port: "next" });
});

it("rejects a missing source or invalid port without constructing a node", () => {
  const graph = branch();
  const settings = options();
  expect(
    selectPaletteEntry(
      graph,
      { kind: "output", output: { from: "gone", port: "next" } },
      { kind: "insert", type: "delay", version: 1 },
      settings,
    ),
  ).toEqual({ ok: false, reason: "missingNode" });
  expect(
    selectPaletteEntry(
      graph,
      { kind: "output", output: { from: "read_true", port: "true" } },
      { kind: "insert", type: "delay", version: 1 },
      settings,
    ),
  ).toEqual({ ok: false, reason: "invalidPort" });
  expect(settings.nameForType).not.toHaveBeenCalled();
});

it("enforces 100 nodes while configuring the existing trigger without dirtying the graph", () => {
  const graph = initialBlankDefinition("Start");
  for (let index = 1; index < 100; index++)
    graph.nodes.push({
      id: `wait_${index}`,
      type: "delay",
      version: 1,
      name: "Wait",
      config: { minutes: { kind: "value", value: 1 } },
    });
  const settings = options();
  expect(
    selectPaletteEntry(
      graph,
      { kind: "detached" },
      { kind: "insert", type: "delay", version: 1 },
      settings,
    ),
  ).toEqual({ ok: false, reason: "nodeLimit" });
  const result = selectPaletteEntry(
    graph,
    { kind: "detached" },
    { kind: "configure", type: "trigger.manual", nodeId: "start", version: 1 },
    settings,
  );
  if (!result.ok) throw new Error("Expected existing-trigger configuration");
  expect(result.definition).toBe(graph);
  expect(result).toMatchObject({ selectedId: "start", changed: false });
  expect(graph.nodes).toHaveLength(100);
  expect(settings.nameForType).not.toHaveBeenCalled();
});

it("keeps representable incomplete drafts instead of fabricating detached reference defaults", () => {
  const graph = branch();
  for (const type of ["record.read", "activity.create", "condition", "delay"] as const) {
    const result = selectPaletteEntry(
      graph,
      { kind: "detached" },
      { kind: "insert", type, version: 1 },
      options(),
    );
    if (!result.ok) throw new Error("Expected incomplete detached insertion");
    const inserted = result.definition.nodes.find((node) => node.id === "inserted");
    expect(inserted).toMatchObject({ type, version: 1, name: "New step" });
    expect(
      Object.values(inserted?.config ?? {}).some(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          "kind" in value &&
          value.kind === "reference",
      ),
    ).toBe(false);
    if (type === "activity.create")
      expect(inserted?.config.subject).toEqual({ kind: "value", value: "Call" });
    if (type === "delay") expect(inserted?.config.minutes).toEqual({ kind: "value", value: 1 });
  }
});

it("is pure and fails closed for unavailable, forged, unconfirmed or unauthorized selections", () => {
  const graph = branch();
  const before = structuredClone(graph);
  const request = { kind: "detached" as const };
  const selection = { kind: "insert", type: "delay", version: 1 };
  const settings = options();
  expect(selectPaletteEntry(graph, request, selection, { ...settings, editable: false })).toEqual({
    ok: false,
    reason: "not-editable",
  });
  expect(
    selectPaletteEntry(graph, request, selection, { ...settings, metadataConfirmed: false }),
  ).toEqual({ ok: false, reason: "metadata-unconfirmed" });
  for (const forged of [
    null,
    { kind: "insert", type: "notification", version: 1 },
    { kind: "insert", type: "delay", version: 2 },
    { kind: "configure", type: "trigger.manual", nodeId: "read_true", version: 1 },
  ])
    expect(selectPaletteEntry(graph, request, forged, settings)).toEqual({
      ok: false,
      reason: "unavailable-action",
    });
  expect(
    selectPaletteEntry(graph, request, selection, { ...settings, newNodeId: "start" }),
  ).toEqual({ ok: false, reason: "unavailable-action" });
  describePaletteContext(graph, { kind: "output", output: { from: "read_true", port: "next" } });
  expect(graph).toEqual(before);
});

it("replaces a step in place, retaining identity, layout, input and compatible output connections", () => {
  const graph = branch();
  graph.layout = { gate: { x: 42, y: 75 } };
  const original = structuredClone(graph);
  const result = selectPaletteEntry(
    graph,
    { kind: "replace", nodeId: "gate" },
    { kind: "insert", type: "delay", version: 1 },
    options(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.definition.nodes.find((node) => node.id === "gate")?.type).toBe("delay");
  expect(result.definition.nodes).toHaveLength(graph.nodes.length);
  expect(result.definition.layout).toEqual(graph.layout);
  expect(result.definition.edges).toContainEqual({ from: "start", to: "gate", port: "next" });
  expect(result.definition.edges.some((edge) => edge.from === "gate")).toBe(false);
  expect(result.definition.nodes.some((node) => node.id === "read_true")).toBe(true);
  expect(graph).toEqual(original);
});

it("uses ephemeral measurements to center an output insertion without moving legacy source coordinates", () => {
  const graph = branch();
  graph.layout = { read_false: { x: 20, y: 500 }, gate: { x: -100, y: 100, anchor: "center" } };
  const before = structuredClone(graph);
  const result = selectPaletteEntry(
    graph,
    { kind: "output", output: { from: "read_false", port: "next" } },
    { kind: "insert", type: "delay", version: 1 },
    { ...options(), measurements: new Map([["read_false", { width: 220, height: 44 }]]) },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.definition.layout?.inserted).toEqual({ x: 130, y: 672, anchor: "center" });
  expect(result.definition.layout?.read_false).toEqual({ x: 20, y: 500 });
  expect(result.definition.layout?.gate).toEqual(graph.layout.gate);
  expect(graph).toEqual(before);
});

it("retains an explicit edge midpoint center through insertion and JSON round-trip", () => {
  const graph = branch();
  graph.layout = { start: { x: 17, y: 9 }, gate: { x: 100, y: 500, anchor: "center" } };
  const result = selectPaletteEntry(
    graph,
    {
      kind: "output",
      output: { from: "start", port: "next" },
      position: { x: 200, y: 250, anchor: "center" },
    },
    { kind: "insert", type: "delay", version: 1 },
    options(),
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.definition.layout?.inserted).toEqual({ x: 200, y: 250, anchor: "center" });
  expect(result.definition.layout?.start).toEqual({ x: 17, y: 9 });
  expect(result.definition.edges).toContainEqual({ from: "start", to: "inserted", port: "next" });
  expect(result.definition.edges).toContainEqual({ from: "inserted", to: "gate", port: "next" });
  expect(definitionSchema.parse(JSON.parse(JSON.stringify(result.definition))).layout).toEqual(
    result.definition.layout,
  );
});
it("does not reset configuration when the same type is chosen, and blocks stale or unauthorized replacement", () => {
  const graph = branch();
  const request = { kind: "replace", nodeId: "gate" } as const;
  const selection = { kind: "insert", type: "condition", version: 1 };
  expect(selectPaletteEntry(graph, request, selection, options())).toMatchObject({
    ok: true,
    changed: false,
    definition: graph,
  });
  expect(selectPaletteEntry(graph, request, selection, { ...options(), editable: false })).toEqual({
    ok: false,
    reason: "not-editable",
  });
  expect(
    selectPaletteEntry(graph, request, selection, { ...options(), metadataConfirmed: false }),
  ).toEqual({ ok: false, reason: "metadata-unconfirmed" });
  expect(
    selectPaletteEntry(graph, { kind: "replace", nodeId: "gone" }, selection, options()),
  ).toEqual({ ok: false, reason: "missingNode" });
  expect(
    selectPaletteEntry(graph, { kind: "replace", nodeId: "start" }, selection, options()),
  ).toEqual({ ok: false, reason: "unavailable-action" });
});
