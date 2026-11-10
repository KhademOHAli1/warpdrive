import type {
  KpiDefinitionInput,
  KpiGraph,
  KpiGraphHandle,
  KpiGraphNode,
  KpiUnit,
} from "./kpiModel";

type Dimension = Map<string, number> | null;
type NodeUnit = { type: "number"; dimension: Dimension } | { type: "boolean" };
export interface KpiGraphUnitIssue {
  nodeId?: string;
  code: string;
}
type OutputUnit = { unit: KpiUnit; currency?: string; customUnit?: string };

// Null denotes a polymorphic constant; an empty map is a measured dimensionless scalar.
function metricDimension(metric: Pick<KpiDefinitionInput, "unit" | "currency">): Dimension {
  if (metric.unit === "custom") return new Map();
  const key = metric.unit === "money" ? `money:${metric.currency ?? ""}` : metric.unit;
  return new Map([[key, 1]]);
}
function compatible(left: Dimension, right: Dimension): boolean {
  if (left === null || right === null) return true;
  return (
    left.size === right.size && Array.from(left).every(([unit, power]) => right.get(unit) === power)
  );
}
function unify(
  left: Dimension,
  right: Dimension,
  nodeId: string,
  issues: KpiGraphUnitIssue[],
): Dimension {
  if (!compatible(left, right)) issues.push({ code: "graph_unit_mismatch", nodeId });
  return left ?? right;
}
function combine(left: Dimension, right: Dimension, sign: 1 | -1): Dimension {
  if (left === null && right === null) return null;
  const result = new Map(left ?? []);
  for (const [unit, power] of right ?? []) {
    const next = (result.get(unit) ?? 0) + power * sign;
    if (next === 0) result.delete(unit);
    else result.set(unit, next);
  }
  return result;
}

function computeDimension(
  node: Extract<KpiGraphNode, { type: "compute" }>,
  input: (handle: KpiGraphHandle) => Dimension,
  issues: KpiGraphUnitIssue[],
): Dimension {
  const left = input("a");
  switch (node.operation) {
    case "abs":
    case "round":
      return left;
    case "add":
    case "subtract":
    case "min":
    case "max":
      return unify(left, input("b"), node.id, issues);
    case "multiply":
      return combine(left, input("b"), 1);
    case "divide":
      return combine(left, input("b"), -1);
    case "percent":
      unify(left, input("b"), node.id, issues);
      return new Map([["percent", 1]]);
  }
}

function unitResolver(graph: KpiGraph, issues: KpiGraphUnitIssue[]) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(
    graph.edges.map((edge) => [`${edge.target}\u0000${edge.targetHandle}`, edge.source]),
  );
  const cache = new Map<string, NodeUnit>();
  const visiting = new Set<string>();
  const numeric = (dimension: Dimension): NodeUnit => ({ type: "number", dimension });
  function input(nodeId: string, handle: KpiGraphHandle): NodeUnit {
    const source = incoming.get(`${nodeId}\u0000${handle}`);
    return source === undefined ? numeric(null) : resolve(source);
  }
  function dimension(nodeId: string, handle: KpiGraphHandle): Dimension {
    const value = input(nodeId, handle);
    return value.type === "number" ? value.dimension : null;
  }
  function branch(nodeId: string): NodeUnit {
    const yes = input(nodeId, "true");
    const no = input(nodeId, "false");
    if (yes.type === "boolean" || no.type === "boolean") return { type: "boolean" };
    return numeric(unify(yes.dimension, no.dimension, nodeId, issues));
  }
  function derive(node: KpiGraphNode): NodeUnit {
    switch (node.type) {
      case "metric":
        return numeric(metricDimension(node.metric));
      case "constant":
        return numeric(null);
      case "compute":
        return numeric(computeDimension(node, (handle) => dimension(node.id, handle), issues));
      case "compare":
        unify(dimension(node.id, "a"), dimension(node.id, "b"), node.id, issues);
        return { type: "boolean" };
      case "logic":
        return { type: "boolean" };
      case "branch":
        return branch(node.id);
      case "output":
        return input(node.id, "value");
    }
  }
  function resolve(id: string): NodeUnit {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const node = nodes.get(id);
    if (node === undefined || visiting.has(id)) return numeric(null);
    visiting.add(id);
    const result = derive(node);
    visiting.delete(id);
    cache.set(id, result);
    return result;
  }
  return resolve;
}

/** Static dimensions include untaken branches; this never performs conversion or FX. */
export function validateKpiGraphUnits(graph: KpiGraph, output: OutputUnit): KpiGraphUnitIssue[] {
  const issues: KpiGraphUnitIssue[] = [];
  const currencies = new Set(
    graph.nodes.flatMap((node) =>
      node.type === "metric" && node.metric.unit === "money" ? [node.metric.currency] : [],
    ),
  );
  if (currencies.size > 1) issues.push({ code: "graph_mixed_currencies" });
  const resolve = unitResolver(graph, issues);
  for (const node of graph.nodes) resolve(node.id);
  const result = resolve(graph.outputNodeId);
  if (output.unit === "custom") return issues;
  if (result.type !== "number" || !compatible(result.dimension, metricDimension(output)))
    issues.push({ code: "graph_output_unit", nodeId: graph.outputNodeId });
  return issues;
}
