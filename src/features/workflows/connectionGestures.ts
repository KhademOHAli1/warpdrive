import { err, ok } from "@/types/result";
import { connectNodes, insertNode } from "./graphEditor";
import type { NodePosition, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./schemas";

export type OutputTarget = Pick<WorkflowEdge, "from" | "port">;

// A fresh gesture from an occupied output moves that connection. Reconnecting an
// endpoint instead removes only the explicitly selected edge, never a neighbor.
export function drawConnection(
  graph: WorkflowDefinition,
  edge: WorkflowEdge,
  previous?: WorkflowEdge,
) {
  const replaced =
    previous ?? graph.edges.find((item) => item.from === edge.from && item.port === edge.port);
  if (replaced?.from === edge.from && replaced.to === edge.to && replaced.port === edge.port)
    return ok(graph);
  return connectNodes(graph, edge, replaced);
}

export function appendConnectedNode(
  graph: WorkflowDefinition,
  node: WorkflowNode,
  position: NodePosition,
  output: OutputTarget,
) {
  const previous = graph.edges.find(
    (edge) => edge.from === output.from && edge.port === output.port,
  );
  const inserted = insertNode(graph, node, position);
  if (inserted === graph) return err("nodeLimit" as const);
  const connected = connectNodes(inserted, { ...output, to: node.id }, previous);
  if (!connected.ok || previous === undefined) return connected;
  return connectNodes(connected.value, { from: node.id, to: previous.to, port: "next" });
}
