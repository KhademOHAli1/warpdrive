import { err, ok } from "@/types/result";
import { currentLayout } from "./nodeLayout";
import type { NodePosition, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./schemas";

export type ConnectionProblem =
  | "missingNode"
  | "cycle"
  | "occupiedInput"
  | "occupiedOutput"
  | "invalidPort";
export function edgeId(edge: WorkflowEdge) {
  return `${edge.from}:${edge.port}:${edge.to}`;
}
export function portsFor(node: WorkflowNode): WorkflowEdge["port"][] {
  return node.type === "condition" ? ["true", "false"] : ["next"];
}
export function disconnectNodes(graph: WorkflowDefinition, edge: WorkflowEdge): WorkflowDefinition {
  return { ...graph, edges: graph.edges.filter((item) => edgeId(item) !== edgeId(edge)) };
}
export function connectNodes(
  graph: WorkflowDefinition,
  edge: WorkflowEdge,
  previous?: WorkflowEdge,
) {
  const candidate = previous === undefined ? graph : disconnectNodes(graph, previous);
  const source = candidate.nodes.find((node) => node.id === edge.from);
  const target = candidate.nodes.find((node) => node.id === edge.to);
  if (source === undefined || target === undefined) return err("missingNode" as const);
  if (target.type.startsWith("trigger.") || !portsFor(source).includes(edge.port))
    return err("invalidPort" as const);
  if (candidate.edges.some((item) => item.from === edge.from && item.port === edge.port))
    return err("occupiedOutput" as const);
  if (candidate.edges.some((item) => item.to === edge.to)) return err("occupiedInput" as const);
  const pending = [edge.to];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === edge.from) return err("cycle" as const);
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const next of candidate.edges.filter((item) => item.from === current))
      pending.push(next.to);
  }
  return ok({ ...candidate, edges: [...candidate.edges, edge] });
}
export function insertNode(
  graph: WorkflowDefinition,
  node: WorkflowNode,
  position: NodePosition,
): WorkflowDefinition {
  if (graph.nodes.length >= 100 || graph.nodes.some((item) => item.id === node.id)) return graph;
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    layout: { ...currentLayout(graph), [node.id]: position },
  };
}
export function moveNode(
  graph: WorkflowDefinition,
  id: string,
  position: NodePosition,
): WorkflowDefinition {
  if (!graph.nodes.some((node) => node.id === id)) return graph;
  return {
    ...graph,
    layout: {
      ...currentLayout(graph),
      [id]: {
        x: Math.max(-100000, Math.min(100000, position.x)),
        y: Math.max(-100000, Math.min(100000, position.y)),
      },
    },
  };
}
export function removeNode(graph: WorkflowDefinition, id: string): WorkflowDefinition {
  if (!graph.nodes.some((node) => node.id === id && !node.type.startsWith("trigger.")))
    return graph;
  const layout = currentLayout(graph);
  delete layout[id];
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => node.id !== id),
    edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
    layout,
  };
}
