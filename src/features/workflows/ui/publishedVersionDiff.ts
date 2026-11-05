import { configurationLimits } from "../configurationLimits";
import type { WorkflowDefinition, WorkflowEdge } from "../schemas";

export interface ComparableVersion {
  name: string;
  definition: WorkflowDefinition;
}
export interface StepDifference {
  ordinal: number;
  beforeName: string;
  afterName: string;
  nameChanged: boolean;
  kindChanged: boolean;
  versionChanged: boolean;
  namingChanged: boolean;
  configurationChanged: boolean;
}
export interface ConnectionDifference {
  ordinal: number;
  fromName: string;
  toName: string;
  port: WorkflowEdge["port"];
}
export interface VersionDifference {
  nameChanged: boolean;
  layoutChanged: boolean;
  addedSteps: { ordinal: number; name: string }[];
  removedSteps: { ordinal: number; name: string }[];
  changedSteps: StepDifference[];
  addedConnections: ConnectionDifference[];
  removedConnections: ConnectionDifference[];
  unchanged: boolean;
}

// Graph bounds match the stored definition schema. The local work ceiling also
// stops excessive or cyclic retained JSON without rendering any submitted value.
const limits = { nodes: 100, edges: 200, values: 100_000 } as const;
const unavailable = () => new Error("Published version comparison unavailable");
interface Budget {
  remaining: number;
}
// Retained JSON can contain node versions beyond the current authoring schema.
interface ComparisonNode {
  name: string;
  type: string;
  version: number;
  nameMode: "automatic" | "custom" | undefined;
  config: Record<string, unknown>;
}
interface ComparisonDefinition {
  nodes: Map<string, ComparisonNode>;
  edges: unknown[];
  layout: unknown;
}
function spend(budget: Budget): void {
  budget.remaining -= 1;
  if (budget.remaining < 0) throw unavailable();
}
function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function array(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function validLayout(value: unknown): void {
  if (value === undefined) return;
  if (!record(value) || Object.keys(value).length > limits.nodes) throw unavailable();
  for (const [key, point] of Object.entries(value)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) ||
      !record(point) ||
      !onlyKeys(point, ["x", "y", "anchor"]) ||
      (point.anchor !== undefined && point.anchor !== "center") ||
      !Object.hasOwn(point, "x") ||
      !Object.hasOwn(point, "y") ||
      typeof point.x !== "number" ||
      !Number.isFinite(point.x) ||
      Math.abs(point.x) > 100_000 ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.y) ||
      Math.abs(point.y) > 100_000
    )
      throw unavailable();
  }
}
function queueJsonChildren(current: unknown, pending: unknown[], budget: Budget): void {
  if (array(current)) {
    if (current.length + pending.length > budget.remaining) throw unavailable();
    for (const item of current) pending.push(item);
    return;
  }
  if (!record(current)) throw unavailable();
  for (const key in current) {
    if (!Object.hasOwn(current, key)) continue;
    if (pending.length >= budget.remaining) throw unavailable();
    pending.push(current[key]);
  }
}
function validJson(value: unknown, budget: Budget): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    spend(budget);
    const current = pending.pop();
    if (current === null || typeof current === "string" || typeof current === "boolean") continue;
    if (typeof current === "number" && Number.isFinite(current)) continue;
    queueJsonChildren(current, pending, budget);
  }
}
function queueComparableChildren(
  before: unknown,
  after: unknown,
  pending: [unknown, unknown][],
): boolean {
  if (array(before) && array(after)) {
    if (before.length !== after.length) return false;
    for (let index = 0; index < before.length; index++) pending.push([before[index], after[index]]);
    return true;
  }
  if (!record(before) || !record(after)) return false;
  const keys = Object.keys(before).sort();
  const otherKeys = Object.keys(after).sort();
  if (keys.length !== otherKeys.length || keys.some((key, index) => key !== otherKeys[index]))
    return false;
  for (const key of keys) pending.push([before[key], after[key]]);
  return true;
}
function jsonEqual(left: unknown, right: unknown, budget: Budget): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  while (pending.length > 0) {
    spend(budget);
    const pair = pending.pop();
    if (pair === undefined) break;
    const [before, after] = pair;
    if (before === after) continue;
    if (!queueComparableChildren(before, after, pending)) return false;
  }
  return true;
}
function parseDefinition(definition: unknown, budget: Budget): ComparisonDefinition {
  if (
    !record(definition) ||
    !onlyKeys(definition, ["schemaVersion", "nodes", "edges", "layout"]) ||
    definition.schemaVersion !== 1 ||
    !array(definition.nodes) ||
    definition.nodes.length < 1 ||
    definition.nodes.length > limits.nodes ||
    !array(definition.edges) ||
    definition.edges.length > limits.edges
  )
    throw unavailable();
  validLayout(definition.layout);
  const nodes = new Map<string, ComparisonNode>();
  for (const node of definition.nodes) {
    if (
      !record(node) ||
      !onlyKeys(node, ["id", "type", "version", "name", "nameMode", "config"]) ||
      typeof node.id !== "string" ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(node.id) ||
      nodes.has(node.id) ||
      typeof node.name !== "string" ||
      node.name.length < configurationLimits.nameMin ||
      node.name.length > configurationLimits.nameMax ||
      typeof node.type !== "string" ||
      node.type.length === 0 ||
      typeof node.version !== "number" ||
      !Number.isSafeInteger(node.version) ||
      node.version < 1 ||
      (node.nameMode !== undefined &&
        node.nameMode !== "automatic" &&
        node.nameMode !== "custom") ||
      !record(node.config)
    )
      throw unavailable();
    validJson(node.config, budget);
    nodes.set(node.id, {
      name: node.name,
      type: node.type,
      version: node.version,
      nameMode: node.nameMode,
      config: node.config,
    });
  }
  validJson(definition.layout ?? {}, budget);
  return { nodes, edges: definition.edges, layout: definition.layout };
}
function connections(
  edges: unknown[],
  nodes: Map<string, ComparisonNode>,
): Map<string, WorkflowEdge[]> {
  const result = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    if (
      !record(edge) ||
      !onlyKeys(edge, ["from", "port", "to"]) ||
      typeof edge.from !== "string" ||
      typeof edge.to !== "string" ||
      !nodes.has(edge.from) ||
      !nodes.has(edge.to) ||
      (edge.port !== "next" && edge.port !== "true" && edge.port !== "false")
    )
      throw unavailable();
    const key = JSON.stringify([edge.from, edge.port, edge.to]);
    const existing = result.get(key);
    const connection: WorkflowEdge = { from: edge.from, port: edge.port, to: edge.to };
    if (existing === undefined) result.set(key, [connection]);
    else existing.push(connection);
  }
  return result;
}
function connectionNames(
  edge: WorkflowEdge,
  nodes: Map<string, ComparisonNode>,
  ordinal: number,
): ConnectionDifference {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (from === undefined || to === undefined) throw unavailable();
  return { ordinal, fromName: from.name, toName: to.name, port: edge.port };
}
function connectionDifference(
  source: Map<string, WorkflowEdge[]>,
  other: Map<string, WorkflowEdge[]>,
  nodes: Map<string, ComparisonNode>,
): ConnectionDifference[] {
  const result: ConnectionDifference[] = [];
  for (const key of [...source.keys()].sort()) {
    const edges = source.get(key) ?? [];
    const count = edges.length - (other.get(key)?.length ?? 0);
    const first = edges[0];
    if (first !== undefined)
      for (let index = 0; index < count; index++)
        result.push(connectionNames(first, nodes, result.length));
  }
  return result;
}

function compareVersions(before: unknown, after: unknown): VersionDifference {
  if (
    !record(before) ||
    !record(after) ||
    typeof before.name !== "string" ||
    typeof after.name !== "string"
  )
    throw unavailable();
  const budget: Budget = { remaining: limits.values };
  const previousDefinition = parseDefinition(before.definition, budget);
  const currentDefinition = parseDefinition(after.definition, budget);
  const previous = previousDefinition.nodes;
  const current = currentDefinition.nodes;
  const addedSteps: VersionDifference["addedSteps"] = [];
  const removedSteps: VersionDifference["removedSteps"] = [];
  const changedSteps: StepDifference[] = [];
  for (const id of [...current.keys()].sort()) {
    const node = current.get(id);
    if (node === undefined) continue;
    const old = previous.get(id);
    if (old === undefined) {
      addedSteps.push({ ordinal: addedSteps.length, name: node.name });
      continue;
    }
    const change: StepDifference = {
      ordinal: changedSteps.length,
      beforeName: old.name,
      afterName: node.name,
      nameChanged: old.name !== node.name,
      kindChanged: old.type !== node.type,
      versionChanged: old.version !== node.version,
      namingChanged: old.nameMode !== node.nameMode,
      configurationChanged: !jsonEqual(old.config, node.config, budget),
    };
    if (
      change.nameChanged ||
      change.kindChanged ||
      change.versionChanged ||
      change.namingChanged ||
      change.configurationChanged
    )
      changedSteps.push(change);
  }
  for (const id of [...previous.keys()].sort()) {
    const node = previous.get(id);
    if (!current.has(id) && node !== undefined)
      removedSteps.push({ ordinal: removedSteps.length, name: node.name });
  }
  const previousConnections = connections(previousDefinition.edges, previous);
  const currentConnections = connections(currentDefinition.edges, current);
  const addedConnections = connectionDifference(currentConnections, previousConnections, current);
  const removedConnections = connectionDifference(
    previousConnections,
    currentConnections,
    previous,
  );
  const nameChanged = before.name !== after.name;
  const layoutChanged = !jsonEqual(
    previousDefinition.layout ?? {},
    currentDefinition.layout ?? {},
    budget,
  );
  return {
    nameChanged,
    layoutChanged,
    addedSteps,
    removedSteps,
    changedSteps,
    addedConnections,
    removedConnections,
    unchanged:
      !nameChanged &&
      !layoutChanged &&
      addedSteps.length === 0 &&
      removedSteps.length === 0 &&
      changedSteps.length === 0 &&
      addedConnections.length === 0 &&
      removedConnections.length === 0,
  };
}

export function comparePublishedVersions(before: unknown, after: unknown): VersionDifference {
  try {
    return compareVersions(before, after);
  } catch {
    // Historical JSON is not reparsed by the exact-version reader. Never expose
    // a thrown payload or property value through comparison diagnostics.
    throw unavailable();
  }
}
