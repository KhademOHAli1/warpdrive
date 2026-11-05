import { portsFor } from "./graphPorts";
import type { MappingAvailability } from "./mappingTypes";
import type { WorkflowDefinition, WorkflowNode } from "./schemas";

interface MappingPath {
  nodes: WorkflowNode[];
  issue?: MappingAvailability;
}
type PathStep =
  | { kind: "root" }
  | { kind: "parent"; node: WorkflowNode }
  | { kind: "invalid"; issue: MappingAvailability };

function validPort(
  source: WorkflowNode,
  port: WorkflowDefinition["edges"][number]["port"],
): boolean {
  return portsFor(source).includes(port);
}

function uniqueNode(definition: WorkflowDefinition, id: string): WorkflowNode | undefined {
  const found = definition.nodes.filter((node) => node.id === id);
  return found.length === 1 ? found[0] : undefined;
}

function previousStep(definition: WorkflowDefinition, current: WorkflowNode): PathStep {
  const incoming = definition.edges.filter((edge) => edge.to === current.id);
  if (incoming.length === 0)
    return current.type === "trigger.manual" ||
      current.type === "trigger.schedule" ||
      current.type === "trigger.webhook"
      ? { kind: "root" }
      : { kind: "invalid", issue: "not-upstream" };
  if (incoming.length !== 1 || current.type.startsWith("trigger."))
    return { kind: "invalid", issue: "ambiguous-path" };
  const edge = incoming[0];
  if (edge === undefined) return { kind: "invalid", issue: "ambiguous-path" };
  const source = uniqueNode(definition, edge.from);
  if (source === undefined) return { kind: "invalid", issue: "source-missing" };
  const samePort = definition.edges.filter(
    (candidate) => candidate.from === source.id && candidate.port === edge.port,
  );
  if (samePort.length !== 1) return { kind: "invalid", issue: "ambiguous-path" };
  return validPort(source, edge.port)
    ? { kind: "parent", node: source }
    : { kind: "invalid", issue: "ambiguous-path" };
}

export function mappingPathNodes(
  definition: WorkflowDefinition,
  nodeId: string,
  includeCurrent = false,
): MappingPath {
  const visited = new Set<string>();
  const path: WorkflowNode[] = [];
  let current = uniqueNode(definition, nodeId);
  if (current === undefined) return { nodes: [], issue: "source-missing" };
  for (let count = 0; count <= definition.nodes.length; count++) {
    if (visited.has(current.id)) return { nodes: [], issue: "ambiguous-path" };
    visited.add(current.id);
    path.push(current);
    const step = previousStep(definition, current);
    if (step.kind === "invalid") return { nodes: [], issue: step.issue };
    if (step.kind === "root") {
      const nodes = path.reverse();
      return { nodes: includeCurrent ? nodes : nodes.filter((node) => node.id !== nodeId) };
    }
    current = step.node;
  }
  return { nodes: [], issue: "ambiguous-path" };
}
