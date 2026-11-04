import { appendConnectedNode, type OutputTarget } from "./connectionGestures";
import { type ConnectionProblem, insertNode, portsFor } from "./graphEditor";
import { mappingPathNodes } from "./mappingAvailability";
import {
  describeMappingOutputsAfter,
  legacyMappingTarget,
  mappingOutputForReference,
} from "./mappingCatalog";
import { mappingCompatibility } from "./mappingCompatibility";
import { coarseMappingType } from "./mappingOutputs";
import { type CreatableNodeType, makeNode } from "./nodeFactory";
import { positionForNewNode } from "./nodeLayout";
import { findPaletteEntry, type PaletteCatalogEntry, paletteCatalog } from "./paletteCatalog";
import {
  bindingSchema,
  type NodePosition,
  nodeSchema,
  type ValueType,
  type WorkflowDefinition,
  type WorkflowNode,
} from "./schemas";

export type PickerRequest =
  | { kind: "detached"; position?: NodePosition }
  | { kind: "output"; output: OutputTarget; position?: NodePosition };
export type PickerSelection =
  | { kind: "insert"; type: CreatableNodeType; version: 1 }
  | { kind: "configure"; type: "trigger.manual"; nodeId: string; version: 1 };
export type PickerResult =
  | { ok: true; definition: WorkflowDefinition; selectedId: string; changed: boolean }
  | {
      ok: false;
      reason: ConnectionProblem | "not-editable" | "metadata-unconfirmed" | "unavailable-action";
    };
export interface PaletteSource {
  nodeId: string;
  path: string[];
  valueType: ValueType;
  semantic: "deal-id" | "scalar";
}
export interface PaletteContextEntry {
  type: WorkflowNode["type"];
  version: 1;
  reason: ConnectionProblem | "unavailable-action" | null;
  input: { state: "available" | "needs-mapping" | "not-required"; sources: PaletteSource[] };
}
export interface PaletteContext {
  source: { id: string; type: WorkflowNode["type"]; version: 1 } | null;
  output: OutputTarget | null;
  occupiedDestinationId: string | null;
  sources: PaletteSource[];
  entries: PaletteContextEntry[];
}
interface Placement {
  source: PaletteContext["source"];
  output: OutputTarget | null;
  occupiedDestinationId: string | null;
  reason: ConnectionProblem | null;
  upstream: Set<string>;
}
interface SelectionOptions {
  editable: boolean;
  metadataConfirmed: boolean;
  newNodeId: string;
  selectedId?: string;
  nameForType: (type: CreatableNodeType) => string;
  subject: string;
}

function placementFor(definition: WorkflowDefinition, request: PickerRequest): Placement {
  const empty = {
    source: null,
    output: null,
    occupiedDestinationId: null,
    reason: null,
    upstream: new Set<string>(),
  };
  if (request.kind === "detached") return empty;
  const source = definition.nodes.find((node) => node.id === request.output.from);
  if (source === undefined) return { ...empty, output: request.output, reason: "missingNode" };
  if (!portsFor(source).includes(request.output.port))
    return { ...empty, output: request.output, reason: "invalidPort" };
  const occupied = definition.edges.find(
    (edge) => edge.from === source.id && edge.port === request.output.port,
  );
  return {
    source: { id: source.id, type: source.type, version: source.version },
    output: request.output,
    occupiedDestinationId: occupied?.to ?? null,
    reason: null,
    upstream: new Set(mappingPathNodes(definition, source.id, true).nodes.map((node) => node.id)),
  };
}

function availableSources(
  definition: WorkflowDefinition,
  sourceId: string | undefined,
): PaletteSource[] {
  if (sourceId === undefined) return [];
  return describeMappingOutputsAfter(definition, sourceId).outputs.map((output) => ({
    nodeId: output.nodeId,
    path: [...output.path],
    valueType: coarseMappingType(output.contract),
    semantic: output.contract.entity === "deal" ? "deal-id" : "scalar",
  }));
}

function manualTrigger(definition: WorkflowDefinition): WorkflowNode | undefined {
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  const trigger = triggers[0];
  return triggers.length === 1 &&
    trigger?.type === "trigger.manual" &&
    findPaletteEntry(trigger.type, trigger.version) !== undefined
    ? trigger
    : undefined;
}

function entryReason(
  definition: WorkflowDefinition,
  descriptor: PaletteCatalogEntry,
  placement: Placement,
): PaletteContextEntry["reason"] {
  if (descriptor.selection === "unavailable") return "unavailable-action";
  if (descriptor.selection === "configure")
    return manualTrigger(definition) === undefined ? "unavailable-action" : null;
  if (placement.reason !== null) return placement.reason;
  if (definition.nodes.length >= 100) return "nodeLimit";
  if (descriptor.type === "condition" && placement.occupiedDestinationId !== null)
    return "invalidPort";
  return null;
}

function acceptsInput(
  definition: WorkflowDefinition,
  kind: PaletteCatalogEntry["input"],
  source: PaletteSource,
): boolean {
  if (kind === "none") return false;
  const output = mappingOutputForReference(definition, {
    kind: "reference",
    nodeId: source.nodeId,
    path: source.path,
  });
  if (output === undefined) return false;
  const target = legacyMappingTarget("target", kind === "optional" ? "text" : kind);
  return mappingCompatibility(output.contract, target) !== "incompatible";
}

function inputContext(
  definition: WorkflowDefinition,
  descriptor: PaletteCatalogEntry,
  sources: PaletteSource[],
): PaletteContextEntry["input"] {
  if (descriptor.input === "none") return { state: "not-required", sources: [] };
  const compatible = sources.filter((source) => acceptsInput(definition, descriptor.input, source));
  const state =
    compatible.length > 0
      ? "available"
      : descriptor.input === "optional"
        ? "not-required"
        : "needs-mapping";
  return { state, sources: compatible };
}

export function describePaletteContext(
  definition: WorkflowDefinition,
  request: PickerRequest,
): PaletteContext {
  const placement = placementFor(definition, request);
  const sources = availableSources(definition, placement.source?.id);
  return {
    source: placement.source,
    output: placement.output,
    occupiedDestinationId: placement.occupiedDestinationId,
    sources,
    entries: paletteCatalog.map((descriptor) => ({
      type: descriptor.type,
      version: descriptor.version,
      reason: entryReason(definition, descriptor, placement),
      input: inputContext(definition, descriptor, sources),
    })),
  };
}

function parseSelection(raw: unknown): PickerSelection | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  if (!("type" in raw) || !("version" in raw) || !("kind" in raw)) return undefined;
  const descriptor = findPaletteEntry(raw.type, raw.version);
  if (descriptor === undefined) return undefined;
  if (raw.kind === "insert" && descriptor.selection === "insert")
    return { kind: "insert", type: descriptor.type, version: 1 };
  if (
    raw.kind === "configure" &&
    descriptor.type === "trigger.manual" &&
    "nodeId" in raw &&
    typeof raw.nodeId === "string"
  )
    return { kind: "configure", type: "trigger.manual", nodeId: raw.nodeId, version: 1 };
  return undefined;
}

function cleanReferences(node: WorkflowNode, upstream: Set<string>): WorkflowNode {
  const config = Object.fromEntries(
    Object.entries(node.config).filter(([, value]) => {
      const parsed = bindingSchema.safeParse(value);
      return (
        !parsed.success || parsed.data.kind !== "reference" || upstream.has(parsed.data.nodeId)
      );
    }),
  );
  return { ...node, config };
}

function nodePosition(
  definition: WorkflowDefinition,
  request: PickerRequest,
  selectedId: string | undefined,
): NodePosition {
  return (
    request.position ??
    positionForNewNode(
      definition,
      selectedId ?? definition.nodes[0]?.id ?? "start",
      request.kind === "output" ? request.output : undefined,
    )
  );
}

function validPosition(position: NodePosition): boolean {
  return (
    Number.isFinite(position.x) &&
    Number.isFinite(position.y) &&
    Math.abs(position.x) <= 100000 &&
    Math.abs(position.y) <= 100000
  );
}

function insertSelection(
  definition: WorkflowDefinition,
  request: PickerRequest,
  type: CreatableNodeType,
  options: SelectionOptions,
): PickerResult {
  const placement = placementFor(definition, request);
  const sourceId = placement.source?.id;
  const node = cleanReferences(
    makeNode(
      definition,
      type,
      options.newNodeId,
      options.nameForType(type),
      options.subject,
      sourceId,
    ),
    placement.upstream,
  );
  if (!nodeSchema.safeParse(node).success) return { ok: false, reason: "unavailable-action" };
  const position = nodePosition(definition, request, options.selectedId);
  if (!validPosition(position)) return { ok: false, reason: "unavailable-action" };
  if (definition.nodes.some((existing) => existing.id === node.id))
    return { ok: false, reason: "unavailable-action" };
  if (request.kind === "output") {
    const result = appendConnectedNode(definition, node, position, request.output);
    return result.ok
      ? { ok: true, definition: result.value, selectedId: node.id, changed: true }
      : { ok: false, reason: result.error };
  }
  const inserted = insertNode(definition, node, position);
  return inserted === definition
    ? { ok: false, reason: "unavailable-action" }
    : { ok: true, definition: inserted, selectedId: node.id, changed: true };
}

export function selectPaletteEntry(
  definition: WorkflowDefinition,
  request: PickerRequest,
  rawSelection: unknown,
  options: SelectionOptions,
): PickerResult {
  if (!options.metadataConfirmed) return { ok: false, reason: "metadata-unconfirmed" };
  if (!options.editable) return { ok: false, reason: "not-editable" };
  const selection = parseSelection(rawSelection);
  if (selection === undefined) return { ok: false, reason: "unavailable-action" };
  const context = describePaletteContext(definition, request);
  const entry = context.entries.find((item) => item.type === selection.type);
  if (entry === undefined) return { ok: false, reason: "unavailable-action" };
  if (entry.reason !== null) return { ok: false, reason: entry.reason };
  if (selection.kind === "configure") {
    if (manualTrigger(definition)?.id !== selection.nodeId)
      return { ok: false, reason: "unavailable-action" };
    return { ok: true, definition, selectedId: selection.nodeId, changed: false };
  }
  return insertSelection(definition, request, selection.type, options);
}
