import type { KpiGraph, KpiGraphHandle, KpiGraphNode } from "./kpiModel";

type ValueType = "number" | "boolean";
type GraphEdge = KpiGraph["edges"][number];
export interface KpiGraphIssue {
  nodeId?: string;
  edgeId?: string;
  code: string;
}
interface GraphIndex {
  nodes: Map<string, KpiGraphNode>;
  incoming: Map<string, Map<KpiGraphHandle, GraphEdge>>;
}

function indexGraph(graph: KpiGraph): GraphIndex {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Map<KpiGraphHandle, GraphEdge>>();
  for (const edge of graph.edges) {
    let ports = incoming.get(edge.target);
    if (ports === undefined) {
      ports = new Map();
      incoming.set(edge.target, ports);
    }
    if (!ports.has(edge.targetHandle)) ports.set(edge.targetHandle, edge);
  }
  return { nodes, incoming };
}

function typeResolver(index: GraphIndex) {
  const cache = new Map<string, ValueType | null>();
  const visiting = new Set<string>();
  function inputType(id: string, handle: KpiGraphHandle): ValueType | null {
    const source = index.incoming.get(id)?.get(handle)?.source;
    return source === undefined ? null : resolve(source);
  }
  function resolve(id: string): ValueType | null {
    if (cache.has(id)) return cache.get(id) ?? null;
    const node = index.nodes.get(id);
    if (node === undefined || visiting.has(id)) return null;
    visiting.add(id);
    let type: ValueType | null;
    switch (node.type) {
      case "metric":
      case "constant":
      case "compute":
        type = "number";
        break;
      case "compare":
      case "logic":
        type = "boolean";
        break;
      case "output":
        type = inputType(id, "value") === "number" ? "number" : null;
        break;
      case "branch": {
        const yes = inputType(id, "true");
        const no = inputType(id, "false");
        type = yes !== null && yes === no ? yes : null;
        break;
      }
    }
    visiting.delete(id);
    cache.set(id, type);
    return type;
  }
  return { resolve, inputType };
}

export function kpiGraphNodeType(graph: KpiGraph, nodeId: string): ValueType | null {
  if (graph.nodes.length > 40 || graph.edges.length > 80) return null;
  return typeResolver(indexGraph(graph)).resolve(nodeId);
}

/** Branch values are polymorphic; pass the graph to reflect their connected type. */
export function kpiGraphInputHandles(
  node: KpiGraphNode,
  graph?: KpiGraph,
): { handle: KpiGraphHandle; type: ValueType }[] {
  switch (node.type) {
    case "metric":
    case "constant":
      return [];
    case "compute":
      return node.operation === "abs" || node.operation === "round"
        ? [{ handle: "a", type: "number" }]
        : [
            { handle: "a", type: "number" },
            { handle: "b", type: "number" },
          ];
    case "compare":
      return [
        { handle: "a", type: "number" },
        { handle: "b", type: "number" },
      ];
    case "logic":
      return node.operation === "not"
        ? [{ handle: "a", type: "boolean" }]
        : [
            { handle: "a", type: "boolean" },
            { handle: "b", type: "boolean" },
          ];
    case "branch": {
      const type = graph === undefined ? "number" : (kpiGraphNodeType(graph, node.id) ?? "number");
      return [
        { handle: "condition", type: "boolean" },
        { handle: "true", type },
        { handle: "false", type },
      ];
    }
    case "output":
      return [{ handle: "value", type: "number" }];
  }
}

function identityIssues(graph: KpiGraph): KpiGraphIssue[] {
  const issues: KpiGraphIssue[] = [];
  const nodes = new Set<string>();
  const edges = new Set<string>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) issues.push({ code: "graph_duplicate_node", nodeId: node.id });
    nodes.add(node.id);
  }
  for (const edge of graph.edges) {
    if (edges.has(edge.id)) issues.push({ code: "graph_duplicate_edge", edgeId: edge.id });
    edges.add(edge.id);
  }
  const outputs = graph.nodes.filter((node) => node.type === "output");
  if (outputs.length !== 1) issues.push({ code: "graph_output_count" });
  if (!outputs.some((node) => node.id === graph.outputNodeId))
    issues.push({ code: "graph_invalid_output", nodeId: graph.outputNodeId });
  return issues;
}

function edgeIssues(graph: KpiGraph, index: GraphIndex): KpiGraphIssue[] {
  const issues: KpiGraphIssue[] = [];
  const occupied = new Set<string>();
  for (const edge of graph.edges) {
    const target = index.nodes.get(edge.target);
    if (!index.nodes.has(edge.source) || target === undefined) {
      issues.push({ code: "graph_dangling_edge", edgeId: edge.id });
      continue;
    }
    const key = `${edge.target}\u0000${edge.targetHandle}`;
    if (occupied.has(key))
      issues.push({ code: "graph_duplicate_input", nodeId: edge.target, edgeId: edge.id });
    occupied.add(key);
    if (!kpiGraphInputHandles(target).some((port) => port.handle === edge.targetHandle))
      issues.push({ code: "graph_unexpected_input", nodeId: target.id, edgeId: edge.id });
  }
  return issues;
}

function topologyIssues(graph: KpiGraph, index: GraphIndex): KpiGraphIssue[] {
  const issues: KpiGraphIssue[] = [];
  const done = new Set<string>();
  const active = new Set<string>();
  function visit(id: string): void {
    if (done.has(id) || !index.nodes.has(id)) return;
    if (active.has(id)) {
      issues.push({ code: "graph_cycle", nodeId: id });
      return;
    }
    active.add(id);
    for (const edge of index.incoming.get(id)?.values() ?? []) visit(edge.source);
    active.delete(id);
    done.add(id);
  }
  visit(graph.outputNodeId);
  for (const node of graph.nodes)
    if (!done.has(node.id)) issues.push({ code: "graph_unreachable", nodeId: node.id });
  // Cycles must also be rejected in disconnected draft fragments.
  for (const node of graph.nodes) visit(node.id);
  return issues;
}

function nodeInputIssues(
  node: KpiGraphNode,
  index: GraphIndex,
  resolver: ReturnType<typeof typeResolver>,
): KpiGraphIssue[] {
  const issues: KpiGraphIssue[] = [];
  for (const port of kpiGraphInputHandles(node)) {
    const edge = index.incoming.get(node.id)?.get(port.handle);
    if (edge === undefined) {
      issues.push({ code: "graph_missing_input", nodeId: node.id });
      continue;
    }
    if (node.type === "branch" && port.handle !== "condition") continue;
    const type = resolver.resolve(edge.source);
    if (type !== null && type !== port.type)
      issues.push({ code: "graph_type_mismatch", nodeId: node.id, edgeId: edge.id });
  }
  if (node.type === "branch") {
    const yes = resolver.inputType(node.id, "true");
    const no = resolver.inputType(node.id, "false");
    if (yes !== null && no !== null && yes !== no)
      issues.push({ code: "graph_branch_type", nodeId: node.id });
  }
  return issues;
}

/** Structural validation is bounded and pure. Payload schemas validate node configuration. */
export function validateKpiGraph(graph: KpiGraph): KpiGraphIssue[] {
  const bounds: KpiGraphIssue[] = [];
  if (graph.nodes.length > 40) bounds.push({ code: "graph_node_limit" });
  if (graph.edges.length > 80) bounds.push({ code: "graph_edge_limit" });
  if (bounds.length > 0) return bounds;
  const index = indexGraph(graph);
  const resolver = typeResolver(index);
  return [
    ...identityIssues(graph),
    ...edgeIssues(graph, index),
    ...topologyIssues(graph, index),
    ...graph.nodes.flatMap((node) => nodeInputIssues(node, index, resolver)),
  ];
}
